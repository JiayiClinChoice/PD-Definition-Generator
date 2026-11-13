import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import AsyncMock, patch

# Tests never open the application database or call an external AI service.
TEMP = tempfile.TemporaryDirectory(prefix="pd-workspace-tests-")
DB_PATH = Path(TEMP.name) / "test.db"
os.environ["DATABASE_PATH"] = str(DB_PATH)
os.environ["GPT_API_KEY"] = "test-only"
os.environ["GPT_API_URL"] = "https://example.invalid/v1"
os.environ["GPT_MODEL"] = "test-only"

from fastapi import HTTPException
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from app.application import create_app
from configs import settings
from database import AsyncSessionFactory, engine
from schemas import DefinitionOutList, FactOutList, ValidationResult

HEADERS = {"X-Requested-With": "ProtocolDeviationGenerator"}
METADATA = dict(title="Protocol", protocol_no="ABC-1", version="1", version_date="2026-11-11", sponsor="Sponsor")
CATEGORIES = [
    dict(ord=1, name="Safety", description="Safety requirements", method="Extract original text"),
    dict(ord=2, name="Consent", description="Consent requirements", method="Extract original text"),
]
FACTS = [dict(position=1, pd_category_ord=1, pd_category_name="Safety", content="Report serious events.", source="Page 5", checked=0)]
DEFINITIONS = [dict(
    position=1, pd_category_name="1.Safety", pd_ord="1.01", requirements="Report events.",
    description="An event was not reported.", review_method="Medical review", severity="Major", note=None, checked=0,
)]


class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ai_patch = patch("app.application.create_ai_client")
        cls.ai_patch.start()
        cls.context = TestClient(create_app(), headers=HEADERS)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.portal.call(engine.dispose)
        cls.context.__exit__(None, None, None)
        cls.ai_patch.stop()
        TEMP.cleanup()

    def sql(self, statement, params=()):
        with closing(sqlite3.connect(DB_PATH)) as con, con:
            con.execute("PRAGMA foreign_keys=ON")
            return con.execute(statement, params).fetchall()

    def setUp(self):
        self.client.cookies.clear()
        self.sql("DELETE FROM users")
        self.sql("DELETE FROM auth_attempts")

    def register(self, username="alice"):
        response = self.client.post("/auth/register", json={"username": username, "password": "secure-password"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def create(self):
        response = self.client.post("/project/initial", params={"name": "Study"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["id"]

    def workspace(self, project_id):
        response = self.client.get(f"/project/{project_id}/workspace")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def configure(self, project_id):
        response = self.client.put(f"/project/{project_id}/pd_categories", json={"categories": CATEGORIES})
        self.assertEqual(response.status_code, 200, response.text)

    def test_authentication_cookie_restore_logout_and_no_header_impersonation(self):
        self.assertEqual(self.client.get("/projects", headers={"X-User-Id": "alice"}).status_code, 401)
        account = self.register("Alice")
        self.assertEqual(account["username"], "alice")
        cookie = self.client.cookies.get("pd_session")
        self.assertIsNotNone(cookie)
        self.assertEqual(self.client.get("/auth/me").json(), account)
        self.assertNotEqual(self.sql("SELECT token_hash FROM login_sessions")[0][0], cookie)
        self.assertNotIn("secure-password", self.sql("SELECT password_hash FROM accounts")[0][0])
        self.assertEqual(self.client.post("/auth/logout").status_code, 200)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/auth/me", headers={"Cookie": f"pd_session={cookie}"}).status_code, 401)
        self.assertEqual(self.client.post("/auth/login", json={"username": "ALICE", "password": "secure-password"}).status_code, 200)
        self.sql("UPDATE login_sessions SET expires_at = '2000-01-01'")
        self.assertEqual(self.client.get("/projects").status_code, 401)

    def test_validation_duplicate_account_and_csrf(self):
        response = self.client.post("/auth/register", json={"username": "alice", "password": "password-123"})
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("SameSite=strict", response.headers["set-cookie"])
        self.assertEqual(self.client.post("/auth/register", json={"username": "ALICE", "password": "password-123"}).status_code, 409)
        for username, password in [("bad user", "password-123"), ("ab", "password-123"), ("valid", "ab"), (None, "password-123")]:
            self.assertEqual(self.client.post("/auth/register", json={"username": username, "password": password}).status_code, 422)
        self.assertEqual(self.client.post("/project/initial", headers={"X-Requested-With": ""}).status_code, 403)
        self.assertEqual(self.client.get("/project/1/facts", headers={"X-Requested-With": ""}).status_code, 403)
        self.assertEqual(self.client.post("/project/initial", params={"name": "   "}).status_code, 422)

    def test_three_character_password_can_register_and_login(self):
        for password in ["", "a", "ab", "a" * 129]:
            self.assertEqual(self.client.post("/auth/register", json={
                "username": "short-password", "password": password,
            }).status_code, 422)
        credentials = {"username": "short-password", "password": "abc"}
        self.assertEqual(self.client.post("/auth/register", json=credentials).status_code, 200)
        self.assertEqual(self.client.post("/auth/logout").status_code, 200)
        self.assertEqual(self.client.post("/auth/login", json=credentials).status_code, 200)

    def test_multiple_users_cannot_read_or_mutate_each_others_projects(self):
        self.register()
        project_id = self.create()
        cookie = self.client.cookies.get("pd_session")
        self.register("bob")
        self.assertEqual(self.client.get("/projects").json(), [])
        routes = [
            ("GET", f"/project/{project_id}", None),
            ("GET", f"/project/{project_id}/workspace", None),
            ("PUT", f"/project/{project_id}/metadata", METADATA),
            ("PUT", f"/project/{project_id}/pd_categories", {"categories": CATEGORIES}),
            ("PUT", f"/project/{project_id}/facts", {"facts": FACTS}),
            ("PUT", f"/project/{project_id}/definitions", {"definitions": DEFINITIONS}),
            ("POST", f"/project/{project_id}/extract_facts", None),
            ("POST", f"/project/{project_id}/generate_definitions", None),
            ("PUT", f"/project/{project_id}/revise_facts", {"requirements": "Revise"}),
            ("PUT", f"/project/{project_id}/revise_definitions", {"requirements": "Revise"}),
            ("PUT", f"/project/{project_id}/rename?new_name=stolen", None),
            ("DELETE", f"/project/{project_id}", None),
        ]
        for method, path, body in routes:
            with self.subTest(path=path):
                response = self.client.request(method, path, json=body)
                self.assertEqual(response.status_code, 404, response.text)
        response = self.client.post(f"/project/{project_id}/attach", files={"file": ("file.txt", b"test", "text/plain")})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get("/projects", headers={"X-User-Id": "alice"}).json(), [])
        self.assertEqual(self.client.get("/auth/me", headers={"Cookie": f"pd_session={cookie}"}).status_code, 401)
        self.assertEqual(self.client.post("/auth/login", json={"username": "alice", "password": "secure-password"}).status_code, 200)
        self.assertEqual(len(self.client.get("/projects").json()), 1)

    def test_workspace_metadata_categories_and_fields_persist(self):
        self.register()
        project_id = self.create()
        original = self.workspace(project_id)
        self.assertEqual(len(original["categories"]), 14)
        self.assertEqual(len(original["fields"]), 8)
        self.assertEqual(self.client.put(f"/project/{project_id}/metadata", json=METADATA).status_code, 200)
        self.configure(project_id)
        fields = original["fields"]
        fields[0].update(meaning="Edited meaning", allowed_values=["A", "B"], requirements="New requirement", example=["Example"])
        response = self.client.put(f"/project/{project_id}/update_fields", json={"fields": fields})
        self.assertEqual(response.status_code, 200, response.text)
        loaded = self.workspace(project_id)
        self.assertEqual(loaded["project"]["protocol_no"], "ABC-1")
        self.assertEqual(loaded["categories"], CATEGORIES)
        self.assertEqual(loaded["fields"], fields)
        fields[0]["name"] = "custom"
        self.assertEqual(self.client.put(f"/project/{project_id}/update_fields", json={"fields": fields}).status_code, 422)
        self.assertEqual(self.workspace(project_id)["fields"], loaded["fields"])
        self.assertEqual(self.client.put(f"/project/{project_id}/pd_categories", json={"categories": [CATEGORIES[0], CATEGORIES[0]]}).status_code, 422)
        self.assertEqual(self.workspace(project_id)["categories"], CATEGORIES)

    def test_manual_results_and_category_replacement(self):
        self.register()
        project_id = self.create()
        self.configure(project_id)
        self.assertEqual(self.client.put(f"/project/{project_id}/facts", json={"facts": FACTS}).status_code, 200)
        self.assertEqual(self.client.put(f"/project/{project_id}/definitions", json={"definitions": DEFINITIONS}).status_code, 200)
        loaded = self.workspace(project_id)
        self.assertEqual(loaded["facts"], FACTS)
        self.assertEqual(loaded["definitions"], DEFINITIONS)
        self.configure(project_id)
        loaded = self.workspace(project_id)
        self.assertEqual(loaded["facts"], [])
        self.assertEqual(loaded["definitions"], DEFINITIONS)
        self.assertEqual(self.client.put(f"/project/{project_id}/facts", json={"facts": FACTS}).status_code, 200)
        invalid = [{**FACTS[0], "pd_category_name": "Invalid"}]
        self.assertEqual(self.client.put(f"/project/{project_id}/facts", json={"facts": invalid}).status_code, 422)
        self.assertEqual(self.workspace(project_id)["facts"], FACTS)
        self.assertEqual(self.client.put(f"/project/{project_id}/facts", json={"facts": []}).status_code, 200)
        self.assertEqual(self.workspace(project_id)["facts"], [])

    def test_fact_confirmation_persists_and_is_validated(self):
        self.register()
        project_id = self.create()
        self.configure(project_id)
        confirmed = {**FACTS[0], "checked": 1, "position": 99}
        another = {**FACTS[0], "content": "Obtain consent.", "checked": 0}
        response = self.client.put(f"/project/{project_id}/facts", json={"facts": [another, confirmed]})
        self.assertEqual(response.status_code, 200, response.text)
        loaded = self.workspace(project_id)["facts"]
        self.assertEqual([item["checked"] for item in loaded], [0, 1])
        self.assertEqual([item["position"] for item in loaded], [1, 2])
        self.assertEqual(self.sql("SELECT checked FROM facts ORDER BY position"), [(0,), (1,)])
        invalid = {**FACTS[0], "checked": 2}
        self.assertEqual(self.client.put(f"/project/{project_id}/facts", json={"facts": [invalid]}).status_code, 422)
        self.assertEqual(self.workspace(project_id)["facts"], loaded)
        legacy = {key: value for key, value in FACTS[0].items() if key != "checked"}
        self.assertEqual(self.client.put(f"/project/{project_id}/facts", json={"facts": [legacy]}).json()["facts"][0]["checked"], 0)

    def test_ai_keeps_only_unchanged_user_confirmations(self):
        from database.domain_services import set_facts

        self.register()
        project_id = self.create()
        self.configure(project_id)
        confirmed = {**FACTS[0], "checked": 1}
        self.assertEqual(self.client.put(f"/project/{project_id}/facts", json={"facts": [confirmed]}).status_code, 200)
        generated = FactOutList(facts=[FACTS[0], {**FACTS[0], "content": "Changed by AI", "checked": 1}])
        user_id = self.sql("SELECT owner_id FROM projects WHERE id=?", (project_id,))[0][0]

        async def save_generated():
            async with AsyncSessionFactory() as db:
                await set_facts(db, project_id, user_id, generated)

        self.client.portal.call(save_generated)
        loaded = self.workspace(project_id)["facts"]
        self.assertEqual([item["checked"] for item in loaded], [1, 0])
        self.assertEqual([item.position for item in generated.facts], [1, 2])
        self.assertEqual([item.checked for item in generated.facts], [1, 0])

    def test_definition_confirmation_persists_and_is_validated(self):
        self.register()
        project_id = self.create()
        confirmed = {**DEFINITIONS[0], "checked": 1, "position": 99}
        response = self.client.put(f"/project/{project_id}/definitions", json={"definitions": [confirmed]})
        self.assertEqual(response.status_code, 200, response.text)
        loaded = self.workspace(project_id)["definitions"]
        self.assertEqual(loaded[0]["checked"], 1)
        self.assertEqual(loaded[0]["position"], 1)
        self.assertEqual(self.sql("SELECT checked FROM pd_definitions"), [(1,)])
        invalid = {**confirmed, "checked": 2}
        self.assertEqual(self.client.put(f"/project/{project_id}/definitions", json={"definitions": [invalid]}).status_code, 422)
        self.assertEqual(self.workspace(project_id)["definitions"], loaded)
        legacy = {key: value for key, value in DEFINITIONS[0].items() if key != "checked"}
        response = self.client.put(f"/project/{project_id}/definitions", json={"definitions": [legacy]})
        self.assertEqual(response.json()["definitions"][0]["checked"], 0)

    def test_ai_preserves_only_unchanged_definition_confirmations(self):
        import json
        from database.domain_services import get_definition_dict, set_definitions

        self.register()
        project_id = self.create()
        confirmed = {**DEFINITIONS[0], "checked": 1}
        self.assertEqual(self.client.put(f"/project/{project_id}/definitions", json={"definitions": [confirmed]}).status_code, 200)
        user_id = self.sql("SELECT owner_id FROM projects WHERE id=?", (project_id,))[0][0]
        generated = DefinitionOutList(definitions=[
            {**DEFINITIONS[0], "note": "", "position": 98},
            {**DEFINITIONS[0], "pd_ord": "1.02", "checked": 1},
        ])

        async def save_generated():
            async with AsyncSessionFactory() as db:
                context = await get_definition_dict(db, project_id, user_id)
                await db.rollback()
                await set_definitions(db, project_id, user_id, generated)
                return context

        context = self.client.portal.call(save_generated)
        self.assertEqual(json.loads(context["checked"])[0]["checked"], 1)
        self.assertEqual([item.checked for item in generated.definitions], [1, 0])
        self.assertEqual([item["checked"] for item in self.workspace(project_id)["definitions"]], [1, 0])

    def test_ai_definition_positions_are_one_based(self):
        from database.domain_services import set_definitions

        self.register()
        project_id = self.create()
        user_id = self.sql("SELECT owner_id FROM projects WHERE id=?", (project_id,))[0][0]
        generated = DefinitionOutList(definitions=[
            {**DEFINITIONS[0], "position": 99},
            {**DEFINITIONS[0], "pd_ord": "1.02", "position": 0},
        ])

        async def save_generated():
            async with AsyncSessionFactory() as db:
                await set_definitions(db, project_id, user_id, generated)

        self.client.portal.call(save_generated)
        self.assertEqual([item.position for item in generated.definitions], [1, 2])
        self.assertEqual([item["position"] for item in self.workspace(project_id)["definitions"]], [1, 2])

    def test_ai_workflow_transactions_and_lock_release(self):
        self.register()
        project_id = self.create()
        self.configure(project_id)
        self.assertEqual(self.client.post(f"/project/{project_id}/extract_facts").status_code, 409)
        with patch("app.services.project_workflows.upload_file", new=AsyncMock(return_value="file-test")), patch(
            "app.services.project_workflows.validate_protocol",
            new=AsyncMock(return_value=ValidationResult(file_valid=True, meta_data=METADATA)),
        ):
            response = self.client.post(f"/project/{project_id}/attach", files={"file": ("protocol.txt", b"test protocol", "text/plain")})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.post(f"/project/{project_id}/generate_definitions").status_code, 409)
        with patch("app.services.project_workflows.search_fact", new=AsyncMock(return_value=FactOutList(facts=FACTS))):
            self.assertEqual(self.client.post(f"/project/{project_id}/extract_facts").status_code, 200)
        with patch("app.services.project_workflows.generate_definition", new=AsyncMock(return_value=DefinitionOutList(definitions=DEFINITIONS))):
            self.assertEqual(self.client.post(f"/project/{project_id}/generate_definitions").status_code, 200)
        with patch("app.services.project_workflows.revise_fact", new=AsyncMock(return_value=FactOutList(facts=FACTS))):
            self.assertEqual(self.client.put(f"/project/{project_id}/revise_facts", json={"requirements": "Revise"}).status_code, 200)
        with patch("app.services.project_workflows.regenerate_definition", new=AsyncMock(return_value=DefinitionOutList(definitions=DEFINITIONS))):
            self.assertEqual(self.client.put(f"/project/{project_id}/revise_definitions", json={"requirements": "Revise"}).status_code, 200)
        with patch("app.services.project_workflows.search_fact", new=AsyncMock(side_effect=HTTPException(502, "AI unavailable"))):
            self.assertEqual(self.client.post(f"/project/{project_id}/extract_facts").status_code, 502)
        self.assertEqual(self.sql("SELECT agent_operate_token FROM projects")[0][0], None)
        self.assertEqual(self.workspace(project_id)["facts"], FACTS)
        self.assertEqual(self.workspace(project_id)["definitions"], DEFINITIONS)
        with patch("ai.service.delete_file", new=AsyncMock()) as delete_file:
            self.assertEqual(self.client.delete(f"/project/{project_id}").status_code, 200)
            delete_file.assert_awaited_once()
        self.assertEqual(self.client.get("/projects").json(), [])

    def test_active_ai_operation_blocks_all_edits(self):
        self.register()
        project_id = self.create()
        self.sql("UPDATE projects SET agent_operate_token='busy', agent_operate_started_at=CURRENT_TIMESTAMP")
        for method, suffix, body in [
            ("PUT", "/metadata", METADATA),
            ("PUT", "/rename?new_name=new", None),
            ("PUT", "/pd_categories", {"categories": CATEGORIES}),
            ("PUT", "/facts", {"facts": FACTS}),
            ("PUT", "/definitions", {"definitions": DEFINITIONS}),
            ("POST", "/extract_facts", None),
            ("DELETE", "", None),
        ]:
            response = self.client.request(method, f"/project/{project_id}{suffix}", json=body)
            self.assertEqual(response.status_code, 409, response.text)
        self.sql("UPDATE projects SET agent_operate_started_at='2000-01-01'")
        self.assertEqual(self.client.delete(f"/project/{project_id}").status_code, 200)

    def test_login_throttle(self):
        self.register()
        self.client.post("/auth/logout")
        for _ in range(settings.auth_throttle_limit):
            self.assertEqual(self.client.post("/auth/login", json={"username": "alice", "password": "wrong-password"}).status_code, 401)
        response = self.client.post("/auth/login", json={"username": "alice", "password": "wrong-password"})
        self.assertEqual(response.status_code, 429)
        self.assertIn("retry-after", response.headers)

    def test_upload_validation_and_markdown_mime_fallback(self):
        self.register()
        project_id = self.create()
        for name, content, mime, status in [
            ("empty.txt", b"", "text/plain", 400),
            ("executable.exe", b"test", "text/plain", 415),
            ("test.txt", b"test", "application/javascript", 415),
        ]:
            response = self.client.post(f"/project/{project_id}/attach", files={"file": (name, content, mime)})
            self.assertEqual(response.status_code, status, response.text)
        with patch.object(settings, "agent_max_file_size_bytes", 2):
            response = self.client.post(f"/project/{project_id}/attach", files={"file": ("file.txt", b"123", "text/plain")})
            self.assertEqual(response.status_code, 413)
        with patch("app.services.project_workflows.upload_file", new=AsyncMock(return_value="file-test")), patch(
            "app.services.project_workflows.validate_protocol",
            new=AsyncMock(return_value=ValidationResult(file_valid=True, meta_data=METADATA)),
        ):
            response = self.client.post(f"/project/{project_id}/attach", files={"file": ("protocol.md", b"# Protocol", "application/octet-stream")})
            self.assertEqual(response.status_code, 200, response.text)
            response = self.client.post(f"/project/{project_id}/attach", files={"file": ("again.txt", b"test", "text/plain")})
            self.assertEqual(response.status_code, 409)

    def test_account_and_project_management_work_without_ai(self):
        with patch.object(settings, "gpt_api_key", ""), self.assertLogs("app.application", level="WARNING"):
            with TestClient(create_app(), headers=HEADERS) as client:
                self.assertEqual(client.post("/auth/register", json={"username": "no-ai", "password": "secure-password"}).status_code, 200)
                response = client.post("/project/initial", params={"name": "No AI study"})
                self.assertEqual(response.status_code, 200)
                project_id = response.json()["id"]
                self.assertEqual(client.post(f"/project/{project_id}/extract_facts").status_code, 503)
                self.assertEqual(client.delete(f"/project/{project_id}").status_code, 200)

    def test_concurrent_users_have_independent_sessions_and_projects(self):
        async def run_user(index):
            async with AsyncClient(
                transport=ASGITransport(app=self.client.app), base_url="http://testserver",
                headers=HEADERS,
            ) as client:
                response = await client.post("/auth/register", json={
                    "username": f"parallel-{index}", "password": "secure-password",
                })
                self.assertEqual(response.status_code, 200, response.text)
                response = await client.post("/project/initial", params={"name": f"Study {index}"})
                self.assertEqual(response.status_code, 200, response.text)
                project = response.json()
                response = await client.get("/projects")
                self.assertEqual([item["id"] for item in response.json()], [project["id"]])
                return project["id"]

        async def run_all():
            return await asyncio.gather(*(run_user(index) for index in range(6)))

        ids = self.client.portal.call(run_all)
        self.assertEqual(len(set(ids)), 6)


if __name__ == "__main__":
    unittest.main()
import asyncio
