"""Standalone CLI Benchmark & Demonstration of the Real-Time Engine (Phase 3).

Renders live word-by-word streaming transcript with ChatGPT-style typewriter pacing,
blinking cursor, hysteresis speaker tracking, and speculative translation using rich.live.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path
import numpy as np
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from app.realtime_engine.engine import RealtimeEngineEvent, RealtimeMeetingEngine


def generate_synthetic_audio(duration_s: float = 10.0, sr: int = 16000) -> bytes:
    """Generate sample speech-like multi-harmonic audio for offline CLI benchmark."""
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    # Fundamental voice frequency around 150Hz + harmonics + amplitude envelope
    signal = 0.5 * np.sin(2 * np.pi * 150 * t) + 0.3 * np.sin(2 * np.pi * 300 * t) + 0.1 * np.sin(2 * np.pi * 600 * t)
    envelope = np.clip(np.sin(2 * np.pi * 0.8 * t), 0, 1) ** 2
    audio = (signal * envelope * 0.3).astype(np.float32)
    return (audio * 32767).astype(np.int16).tobytes()


async def run_demo(audio_path: str | None = None) -> None:
    console = Console()
    console.print("[bold green]=== Phase 3: Ultra-Low Latency & ChatGPT-Style Smooth Token Streaming ===[/bold green]")
    console.print("[dim]Cadence: 250ms | Prefix-Locked Faster-Whisper | LCP Diffing | Typewriter Cursor[/dim]\n")

    groq_key = os.environ.get("GROQ_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    latest_event: RealtimeEngineEvent | None = None

    async def on_event(event: RealtimeEngineEvent) -> None:
        nonlocal latest_event
        latest_event = event

    engine = RealtimeMeetingEngine(
        whisper_model_size="base",
        whisper_device="cpu",
        whisper_compute_type="int8",
        language="vi",
        gemini_api_key=gemini_key,
        groq_api_key=groq_key,
        tick_interval_s=0.25,  # 250ms cadence
        on_event_callback=on_event,
    )

    await engine.start()

    if audio_path and os.path.exists(audio_path):
        console.print(f"[cyan]Streaming audio from file: {audio_path}[/cyan]")
        import wave
        with wave.open(audio_path, "rb") as wf:
            raw_data = wf.readframes(wf.getnframes())
    else:
        console.print("[yellow]No audio file provided. Streaming synthetic speech audio...[/yellow]")
        raw_data = generate_synthetic_audio(duration_s=8.0)

    # 40ms chunk size (1280 bytes = 640 samples at 16kHz)
    chunk_size = 1280
    chunk_interval = 0.040

    cursor_visible = True
    last_cursor_toggle = time.time()

    def make_display() -> Layout:
        nonlocal cursor_visible, last_cursor_toggle
        if time.time() - last_cursor_toggle > 0.4:
            cursor_visible = not cursor_visible
            last_cursor_toggle = time.time()

        cursor_char = "▋" if cursor_visible else " "

        layout = Layout()
        layout.split(
            Layout(name="header", size=3),
            Layout(name="main", ratio=1),
            Layout(name="footer", size=3),
        )

        header_table = Table.grid(expand=True)
        header_table.add_column(justify="left")
        header_table.add_column(justify="right")
        header_table.add_row(
            "[bold white]PHASE 3 STREAMING: 250MS PREFIX-LOCKED + LCP DIFF[/bold white]",
            f"[dim]Cadence: 250ms | Latency: {latest_event.latency_ms if latest_event else 0}ms[/dim]",
        )
        layout["header"].update(Panel(header_table, style="blue"))

        # Main transcript box
        content = Text()
        if latest_event:
            spk_color = "magenta" if latest_event.speaker == "SPEAKER_01" else "cyan"
            content.append(f"[{latest_event.speaker}]: ", style=f"bold {spk_color}")

            # 1. Locked Prefix (Solid white)
            if latest_event.locked_prefix:
                content.append(f"{latest_event.locked_prefix} ", style="bold white")
            elif latest_event.confirmed_text:
                content.append(f"{latest_event.confirmed_text} ", style="bold white")

            # 2. Mutable Tail (Yellow / Syllable in flight)
            if latest_event.mutable_tail:
                content.append(f"{latest_event.mutable_tail} ", style="italic yellow")
            elif latest_event.tentative_text:
                content.append(f"{latest_event.tentative_text} ", style="italic yellow")

            # 3. Blinking typewriter cursor
            if not latest_event.is_final:
                content.append(cursor_char, style="bold cyan")

            # 4. Translation stream
            if latest_event.live_translation:
                content.append("\n\n[Ban dich]: ", style="bold green")
                content.append(latest_event.live_translation, style="green")
                if not latest_event.is_final:
                    content.append(f" {cursor_char}", style="bold green")
        else:
            content.append("Đang chờ âm thanh...", style="dim")

        layout["main"].update(
            Panel(
                content,
                title="Thời gian thực (ChatGPT Typewriter & Prefix-Locked Faster-Whisper)",
                border_style="green",
            )
        )

        status_text = (
            "[bold cyan]● Trạng thái:[/bold cyan] "
            + ("[bold green]Đang nói (Streaming tokens)...[/bold green]" if latest_event and not latest_event.is_final else "[dim]Im lặng / Đã chốt[/dim]")
        )
        layout["footer"].update(Panel(status_text, style="dim"))
        return layout

    with Live(make_display(), refresh_per_second=15, console=console) as live:
        for i in range(0, len(raw_data), chunk_size):
            chunk = raw_data[i : i + chunk_size]
            engine.push_audio(chunk)
            live.update(make_display())
            await asyncio.sleep(chunk_interval)

        # Allow trailing ticks to finalize
        for _ in range(10):
            live.update(make_display())
            await asyncio.sleep(0.25)

    await engine.stop()
    console.print("\n[bold green]Benchmark completed successfully![/bold green]")


if __name__ == "__main__":
    file_arg = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(run_demo(file_arg))
