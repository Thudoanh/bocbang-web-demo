from app.free_stack import process_commands


def test_free_stack_runs_api_and_workers_with_small_footprint() -> None:
    commands = dict(process_commands("9876"))

    assert set(commands) == {"worker", "reconciler", "api"}
    assert commands["worker"][-2:] == ("--threads", "1")
    assert commands["api"][-2:] == ("--port", "9876")
