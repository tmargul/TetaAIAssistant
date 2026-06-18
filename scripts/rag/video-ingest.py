#!/usr/bin/env python3
"""
MP4 → knowledge-chunks.jsonl (format teta-knowledge-chunk-v1).

Wymaga: ffmpeg, ffprobe, faster-whisper (pip install -r requirements-video.txt).
Wynik: JSONL + klatki JPG + manifest.json + result.json (ścieżki dla CLI NestJS).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def configure_utf8_stdio() -> None:
    """Windows: konsola Node często używa cp1250 — wymuszamy UTF-8 dla polskich komunikatów."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")


def resolve_executable(name: str, configured: str) -> str:
    candidate = configured.strip() or name
    if Path(candidate).is_file():
        return str(Path(candidate).resolve())
    resolved = shutil.which(candidate)
    if resolved:
        return resolved
    label = "ffprobe" if "probe" in candidate.lower() else "ffmpeg" if "ffmpeg" in candidate.lower() else candidate
    raise RuntimeError(
        f"Nie znaleziono {label} ({candidate!r}). "
        f"Zainstaluj ffmpeg (np. winget install Gyan.FFmpeg) i dodaj do PATH, "
        f"lub ustaw TETA_FFMPEG_PATH / TETA_FFPROBE_PATH w apps/api/.env."
    )


def validate_prerequisites(args: argparse.Namespace) -> tuple[str, str]:
    ffmpeg = resolve_executable("ffmpeg", args.ffmpeg)
    ffprobe = resolve_executable("ffprobe", args.ffprobe)
    try:
        import faster_whisper  # noqa: F401  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "Brak pakietu faster-whisper. Zainstaluj: pip install -r scripts/rag/requirements-video.txt"
        ) from exc
    return ffmpeg, ffprobe


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transkrypcja MP4 do knowledge-chunks.jsonl")
    parser.add_argument("--input", required=True, help="Ścieżka do pliku .mp4")
    parser.add_argument("--output", required=True, help="Katalog wyjściowy roboczy")
    parser.add_argument("--chunk-seconds", type=float, default=180.0, help="Długość chunka w sekundach")
    parser.add_argument(
        "--whisper-model",
        default="large-v3-turbo",
        help="Model faster-whisper (np. large-v3-turbo, large-v3, medium)",
    )
    parser.add_argument("--language", default="pl", help="Kod języka Whisper")
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda"],
        help="Urządzenie inference Whisper",
    )
    parser.add_argument("--ffmpeg", default="ffmpeg", help="Ścieżka do ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe", help="Ścieżka do ffprobe")
    parser.add_argument(
        "--frames-per-chunk",
        type=int,
        default=3,
        help="Liczba klatek JPG przypisanych do chunka",
    )
    return parser.parse_args()


def run_cmd(cmd: list[str], label: str) -> None:
    try:
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"{label}: nie znaleziono polecenia „{cmd[0]}”. "
            "Zainstaluj ffmpeg i dodaj do PATH lub ustaw TETA_FFMPEG_PATH / TETA_FFPROBE_PATH."
        ) from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(f"{label} nie powiodło się: {stderr or exc}") from exc


def probe_duration(video_path: Path, ffprobe: str) -> float:
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Nie znaleziono ffprobe ({ffprobe!r}). "
            "Zainstaluj ffmpeg (np. winget install Gyan.FFmpeg)."
        ) from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(f"ffprobe nie powiodło się: {stderr or exc}") from exc
    return float(result.stdout.strip())


def sec_to_hhmmss(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}"


def extract_audio(video_path: Path, wav_path: Path, ffmpeg: str) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(video_path),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(wav_path),
    ]
    run_cmd(cmd, "Ekstrakcja audio (ffmpeg)")


def extract_frame(video_path: Path, timestamp: float, out_path: Path, ffmpeg: str) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-y",
        "-ss",
        f"{max(0.0, timestamp):.3f}",
        "-i",
        str(video_path),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(out_path),
    ]
    run_cmd(cmd, f"Ekstrakcja klatki @{timestamp:.1f}s")


def resolve_device(device: str) -> tuple[str, str]:
    if device != "auto":
        compute = "float16" if device == "cuda" else "int8"
        return device, compute

    try:
        import torch  # type: ignore[import-not-found]

        if torch.cuda.is_available():
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def transcribe_audio(
    wav_path: Path,
    model_name: str,
    language: str,
    device: str,
) -> list[dict[str, float | str]]:
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "Brak pakietu faster-whisper. Zainstaluj: pip install -r scripts/rag/requirements-video.txt"
        ) from exc

    resolved_device, compute_type = resolve_device(device)
    print(
        f"[video-ingest] Whisper: model={model_name}, device={resolved_device}, compute={compute_type}",
        file=sys.stderr,
    )

    model = WhisperModel(model_name, device=resolved_device, compute_type=compute_type)
    segments_iter, _info = model.transcribe(
        str(wav_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )

    segments: list[dict[str, float | str]] = []
    for segment in segments_iter:
        text = (segment.text or "").strip()
        if not text:
            continue
        segments.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": text,
            }
        )

    if not segments:
        raise RuntimeError("Whisper nie zwrócił żadnych segmentów — sprawdź jakość audio.")

    return segments


def collect_text_for_window(
    segments: list[dict[str, float | str]],
    window_start: float,
    window_end: float,
) -> str:
    parts: list[str] = []
    for segment in segments:
        start = float(segment["start"])
        end = float(segment["end"])
        if end <= window_start or start >= window_end:
            continue
        parts.append(str(segment["text"]).strip())
    return " ".join(parts).strip()


def frame_timestamps_for_chunk(
    chunk_start: float,
    chunk_end: float,
    frames_per_chunk: int,
) -> list[float]:
    if frames_per_chunk <= 0:
        return []

    if chunk_end - chunk_start < 1.0:
        return [chunk_start]

    if frames_per_chunk == 1:
        return [(chunk_start + chunk_end) / 2.0]

    step = (chunk_end - chunk_start) / (frames_per_chunk + 1)
    return [chunk_start + step * (index + 1) for index in range(frames_per_chunk)]


def build_chunks(
    *,
    segments: list[dict[str, float | str]],
    duration: float,
    chunk_seconds: float,
    source: str,
    film_key: str,
    assets_rel_prefix: str,
    video_path: Path,
    frames_dir: Path,
    ffmpeg: str,
    frames_per_chunk: int,
) -> list[dict]:
    chunks: list[dict] = []
    frame_cache: dict[int, str] = {}
    window_start = 0.0

    while window_start < duration - 0.05:
        window_end = min(window_start + chunk_seconds, duration)
        text = collect_text_for_window(segments, window_start, window_end)
        if text:
            frame_paths: list[str] = []
            for timestamp in frame_timestamps_for_chunk(
                window_start, window_end, frames_per_chunk
            ):
                second_key = int(math.floor(timestamp))
                if second_key not in frame_cache:
                    frame_name = f"frame_{second_key:05d}.jpg"
                    frame_abs = frames_dir / frame_name
                    if not frame_abs.exists():
                        extract_frame(video_path, timestamp, frame_abs, ffmpeg)
                    frame_cache[second_key] = f"{assets_rel_prefix}/{frame_name}"
                frame_paths.append(frame_cache[second_key])

            chunks.append(
                {
                    "id": str(uuid.uuid4()),
                    "schema": "teta-knowledge-chunk-v1",
                    "source": source,
                    "source_type": "training_video",
                    "knowledge_version": "teta-knowledge-chunk-v1",
                    "start": round(window_start, 2),
                    "end": round(window_end, 2),
                    "start_hhmmss": sec_to_hhmmss(window_start),
                    "end_hhmmss": sec_to_hhmmss(window_end),
                    "text": text,
                    "summary": "",
                    "topic": "",
                    "module": "",
                    "keywords": [],
                    "concepts": [],
                    "plugin_names": [],
                    "form_names": [],
                    "business_objects": [],
                    "datasets": [],
                    "tables": [],
                    "packages": [],
                    "shortcuts": [],
                    "actions": [],
                    "important_notes": [],
                    "frames": frame_paths,
                }
            )

        if window_end >= duration:
            break
        window_start = window_end

    if not chunks:
        raise RuntimeError("Brak chunków po segmentacji — film może być zbyt krótki lub bez mowy.")

    return chunks


def write_jsonl(chunks: list[dict], jsonl_path: Path) -> None:
    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for chunk in chunks:
            handle.write(json.dumps(chunk, ensure_ascii=False) + "\n")


def main() -> int:
    configure_utf8_stdio()
    args = parse_args()
    ffmpeg, ffprobe = validate_prerequisites(args)

    video_path = Path(args.input).resolve()
    if not video_path.exists():
        raise RuntimeError(f"Nie znaleziono pliku wideo: {video_path}")
    if video_path.suffix.lower() != ".mp4":
        raise RuntimeError("Obsługiwany jest tylko format .mp4")

    output_dir = Path(args.output).resolve()
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    film_key = video_path.stem
    source = f"trainings/{video_path.name}"
    assets_rel_prefix = f"assets/{film_key}"
    frames_dir = output_dir / "assets" / film_key
    wav_path = output_dir / "audio.wav"
    jsonl_path = output_dir / f"{film_key}.jsonl"

    print(f"[video-ingest] Wejście: {video_path}", file=sys.stderr)
    print(f"[video-ingest] Wyjście: {output_dir}", file=sys.stderr)

    duration = probe_duration(video_path, ffprobe)
    print(f"[video-ingest] Długość nagrania: {duration:.1f}s", file=sys.stderr)

    extract_audio(video_path, wav_path, ffmpeg)
    segments = transcribe_audio(wav_path, args.whisper_model, args.language, args.device)

    chunks = build_chunks(
        segments=segments,
        duration=duration,
        chunk_seconds=args.chunk_seconds,
        source=source,
        film_key=film_key,
        assets_rel_prefix=assets_rel_prefix,
        video_path=video_path,
        frames_dir=frames_dir,
        ffmpeg=ffmpeg,
        frames_per_chunk=args.frames_per_chunk,
    )

    write_jsonl(chunks, jsonl_path)

    manifest = {
        "name": "TETA video ingest",
        "schema": "teta-knowledge-chunk-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_format": "knowledge-chunks.jsonl",
        "embedding_model": "nomic-embed-text",
        "embedding_dimension": 768,
        "vector_db": "qdrant",
        "chunks_count": len(chunks),
        "whisper_model": args.whisper_model,
        "chunk_seconds": args.chunk_seconds,
        "assets": {"frames": f"{assets_rel_prefix}/"},
        "sources": [
            {
                "source": source,
                "source_type": "training_video",
                "film_key": film_key,
            }
        ],
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    result = {
        "jsonlPath": str(jsonl_path),
        "manifestPath": str(manifest_path),
        "assetsDir": str(frames_dir),
        "assetsRelPrefix": assets_rel_prefix,
        "filmKey": film_key,
        "source": source,
        "chunkCount": len(chunks),
        "durationSec": duration,
        "whisperModel": args.whisper_model,
        "chunkSeconds": args.chunk_seconds,
    }
    result_path = output_dir / "result.json"
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(json.dumps(result))
    print(
        f"[video-ingest] Gotowe: {len(chunks)} chunków → {jsonl_path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — CLI
        print(f"Błąd: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
