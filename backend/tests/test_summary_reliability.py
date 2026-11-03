import asyncio
import json
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import Database
from app.models.enums import JobStatus
from app.models.media import Job
from app.providers.contracts import LLMCapabilities, LLMProviderError
from app.providers.gemini import GeminiSummaryProvider
from app.providers.groq import GroqSummaryProvider, GroqTranslationProvider
from app.providers.llm import FallbackLLMProvider
from app.providers.summary_validation import validate_summary
from test_ai import _app, _headers, _seed, _session


VALID = {"overview":"Overview", "key_points":["One point"], "action_items":[], "decisions":[], "risks_notes":[]}


@pytest.mark.parametrize("model", ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"])
@pytest.mark.parametrize("template", ["general", None])
def test_groq_sends_actual_summary_schema(monkeypatch, model, template):
    captured = {}
    output = VALID if template else {"content":"Custom summary"}
    class Client:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
        async def post(self, _url, **kwargs):
            captured.update(kwargs["json"])
            return httpx.Response(200, json={"choices":[{"message":{"content":json.dumps(output)}}]})
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    result = asyncio.run(GroqSummaryProvider("test-key",model,"https://groq.test").generate_summary(
        "Meeting transcript", None if template else "Summarize freely", "vi", template))
    schema = captured["response_format"]["json_schema"]
    assert captured["response_format"]["type"] == "json_schema" and schema["strict"] is True
    assert set(schema["schema"]["required"]) == set(output)
    assert schema["schema"]["additionalProperties"] is False
    assert all(name in captured["messages"][0]["content"] for name in output)
    assert result == output


def test_unlisted_model_gets_schema_in_json_prompt(monkeypatch):
    captured = {}
    class Client:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
        async def post(self, _url, **kwargs):
            captured.update(kwargs["json"])
            return httpx.Response(200, json={"choices":[{"message":{"content":json.dumps(VALID)}}]})
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    result = asyncio.run(GroqSummaryProvider("test-key","other-model","https://groq.test").generate_summary("Transcript",None,"vi","general"))
    assert captured["response_format"] == {"type":"json_object"}
    assert '"overview"' in captured["messages"][0]["content"]
    assert result == VALID


@pytest.mark.parametrize("bad", [{"summary":"wrong keys"}, {**VALID,"action_items":[{"owner":"a","task":"b"}]}, {**VALID,"overview":""}])
def test_invalid_success_activates_summary_fallback(bad):
    class Provider:
        def __init__(self, output): self.output, self.calls = output, 0
        def capabilities(self): return LLMCapabilities(True, 131072)
        async def generate_summary(self, *_args):
            self.calls += 1
            return self.output
    primary, fallback = Provider(bad), Provider(VALID)
    result = asyncio.run(FallbackLLMProvider(primary, fallback).generate_summary("Transcript",None,"vi","general"))
    assert result == VALID and primary.calls == fallback.calls == 1


@pytest.mark.parametrize("provider", [GroqSummaryProvider, GeminiSummaryProvider])
def test_adapter_reports_bad_summary_as_provider_error(monkeypatch, provider):
    async def generate(*_args): return {"summary":"Wrong shape"}
    instance = provider("test-key","test-model","https://provider.test")
    monkeypatch.setattr(instance, "_generate", generate)
    with pytest.raises(LLMProviderError) as failure:
        asyncio.run(instance.generate_summary("Transcript",None,"vi","general"))
    assert failure.value.code == "SUMMARY_RESULT_INVALID" and failure.value.retryable is True


def test_custom_summary_contract_is_not_confused_with_template():
    assert validate_summary({"content":"Custom result"}, None) == {"content":"Custom result"}
    with pytest.raises(LLMProviderError):
        validate_summary(VALID, None)


@pytest.mark.parametrize("state", [JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.RETRYING])
def test_repeated_summary_request_reuses_pending_job(tmp_path, state):
    app, sender, url = _app(tmp_path)
    class Provider:
        def capabilities(self): return LLMCapabilities(True,131072)
    app.state.llm_provider = Provider()
    enqueued = []
    app.state.enqueue_job = lambda job_id, _settings: enqueued.append(str(job_id))
    with TestClient(app) as client:
        owner = _session(client,sender,"summary-dedupe@example.com")
        seed = _seed(url,UUID(owner["user"]["id"]))
        path = f"/api/v1/meetings/{seed['meeting_id']}/summaries"
        headers = _headers(owner)
        body = {"mode":"template","template":"general","output_language":"vi"}
        first = client.post(path,headers=headers,json=body)
        assert first.status_code == 202
        job_id = first.json()["id"]
        async def set_state():
            db = Database(url)
            try:
                async with db.session() as session:
                    job = await session.get(Job,UUID(job_id))
                    job.status = state
                    await session.commit()
            finally: await db.dispose()
        asyncio.run(set_state())
        second = client.post(path,headers=headers,json=body)
        assert second.status_code == 202 and second.json()["id"] == job_id
        if state != JobStatus.QUEUED:
            assert len(enqueued) == 1
        async def check_count():
            db = Database(url)
            try:
                async with db.session() as session:
                    assert len(list(await session.scalars(select(Job).where(Job.job_type=="summary")))) == 1
            finally: await db.dispose()
        asyncio.run(check_count())
        # A different template is genuinely different work.
        third = client.post(path,headers=headers,json={**body,"template":"briefing"})
        assert third.status_code == 202 and third.json()["id"] != job_id
