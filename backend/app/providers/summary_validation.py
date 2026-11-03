"""Validate summaries before selecting a successful provider or saving results."""
from app.providers.contracts import LLMProviderError


def validate_summary(value: object, template: str | None) -> dict[str, object]:
    def invalid():
        raise LLMProviderError(
            "AI tóm tắt trả kết quả thiếu trường hoặc sai định dạng.",
            code="SUMMARY_RESULT_INVALID", retryable=True,
        )
    if not isinstance(value, dict):
        invalid()
    if not template:
        text = value.get("content")
        if not isinstance(text, str) or not text.strip():
            invalid()
        return {"content": text.strip()}
    overview = value.get("overview")
    if not isinstance(overview, str) or not overview.strip():
        invalid()
    result: dict[str, object] = {"overview": overview.strip()}
    for key in ("key_points", "action_items", "decisions", "risks_notes"):
        items = value.get(key, [])
        if not isinstance(items, list) or any(not isinstance(item, str) or not item.strip() for item in items):
            invalid()
        result[key] = [item.strip() for item in items]
    return result
