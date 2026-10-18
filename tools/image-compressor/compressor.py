"""独立图片批量压缩核心：递归扫描、等比缩放、透明通道与 EXIF 方向处理。"""

from __future__ import annotations

import argparse
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from PIL import Image, ImageOps


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
FORMAT_EXTENSIONS = {"WEBP": ".webp", "PNG": ".png", "JPEG": ".jpg"}
SOURCE_FORMATS = {".webp": "WEBP", ".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG"}


@dataclass(frozen=True)
class CompressionSettings:
    max_edge: int = 360
    quality: int = 55
    output_format: str = "WEBP"
    keep_smaller_original: bool = True

    def normalized(self) -> "CompressionSettings":
        output_format = self.output_format.upper()
        if output_format == "JPG":
            output_format = "JPEG"
        if output_format not in FORMAT_EXTENSIONS:
            raise ValueError("输出格式必须是 WebP、PNG 或 JPEG")
        if self.max_edge <= 0:
            raise ValueError("最长边必须大于 0")
        if not 1 <= self.quality <= 100:
            raise ValueError("质量必须在 1～100 之间")
        return CompressionSettings(self.max_edge, self.quality, output_format, self.keep_smaller_original)


@dataclass
class FileResult:
    source: Path
    destination: Path | None
    success: bool
    bytes_before: int = 0
    bytes_after: int = 0
    size_before: tuple[int, int] | None = None
    size_after: tuple[int, int] | None = None
    kept_original: bool = False
    warning: str = ""
    error: str = ""


@dataclass
class BatchSummary:
    results: list[FileResult] = field(default_factory=list)

    @property
    def succeeded(self) -> list[FileResult]:
        return [item for item in self.results if item.success]

    @property
    def failed(self) -> list[FileResult]:
        return [item for item in self.results if not item.success]

    @property
    def bytes_before(self) -> int:
        return sum(item.bytes_before for item in self.succeeded)

    @property
    def bytes_after(self) -> int:
        return sum(item.bytes_after for item in self.succeeded)

    @property
    def reduction_percent(self) -> float:
        if not self.bytes_before:
            return 0.0
        return (1 - self.bytes_after / self.bytes_before) * 100


ProgressCallback = Callable[[int, int, FileResult], None]


def discover_images(input_dir: Path, output_dir: Path) -> list[Path]:
    input_dir = input_dir.resolve()
    output_dir = output_dir.resolve()
    files = []
    for path in input_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        resolved = path.resolve()
        if output_dir == resolved or output_dir in resolved.parents:
            continue
        files.append(path)
    return sorted(files, key=lambda item: item.as_posix().casefold())


def has_transparency(image: Image.Image) -> bool:
    return "A" in image.getbands() or (image.mode == "P" and "transparency" in image.info)


def target_size(size: tuple[int, int], max_edge: int) -> tuple[int, int]:
    width, height = size
    longest = max(width, height)
    if longest <= max_edge:
        return size
    scale = max_edge / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


def unique_destination(base: Path, reserved: set[Path]) -> Path:
    candidate = base
    index = 2
    while candidate.exists() or candidate in reserved:
        candidate = base.with_name(f"{base.stem}_{index}{base.suffix}")
        index += 1
    reserved.add(candidate)
    return candidate


def save_image(image: Image.Image, destination: Path, settings: CompressionSettings, transparent: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if settings.output_format == "WEBP":
        converted = image.convert("RGBA" if transparent else "RGB")
        converted.save(
            destination,
            "WEBP",
            quality=settings.quality,
            method=6,
            alpha_quality=max(70, settings.quality),
            exact=transparent,
            exif=b"",
        )
    elif settings.output_format == "PNG":
        converted = image.convert("RGBA" if transparent else "RGB")
        converted.save(destination, "PNG", optimize=True, compress_level=9)
    else:
        if transparent:
            raise ValueError("JPEG 不支持透明通道，请选择 WebP 或 PNG")
        image.convert("RGB").save(
            destination,
            "JPEG",
            quality=settings.quality,
            optimize=True,
            progressive=True,
            exif=b"",
        )


def compress_one(
    source: Path,
    input_dir: Path,
    output_dir: Path,
    settings: CompressionSettings,
    reserved: set[Path],
) -> FileResult:
    result = FileResult(source=source, destination=None, success=False, bytes_before=source.stat().st_size)
    try:
        relative = source.relative_to(input_dir)
        base = output_dir / relative.with_suffix(FORMAT_EXTENSIONS[settings.output_format])
        destination = unique_destination(base, reserved)
        result.destination = destination

        with Image.open(source) as opened:
            if getattr(opened, "n_frames", 1) > 1:
                raise ValueError("检测到多帧图片；为避免破坏动画，已跳过")
            opened.load()
            oriented = ImageOps.exif_transpose(opened)
            transparent = has_transparency(oriented)
            result.size_before = oriented.size
            resized_to = target_size(oriented.size, settings.max_edge)
            working = oriented.resize(resized_to, Image.Resampling.LANCZOS) if resized_to != oriented.size else oriented.copy()
            result.size_after = working.size
            save_image(working, destination, settings, transparent)

        output_bytes = destination.stat().st_size
        same_format = SOURCE_FORMATS.get(source.suffix.lower()) == settings.output_format
        if settings.keep_smaller_original and same_format and output_bytes > result.bytes_before:
            shutil.copy2(source, destination)
            result.kept_original = True
            result.warning = "压缩结果更大，已在输出目录保留较小的原文件"
        elif output_bytes > result.bytes_before:
            result.warning = "压缩结果比原文件更大；因输出格式不同，仍保留转换结果"

        result.bytes_after = destination.stat().st_size
        result.success = True
    except Exception as error:  # 每个文件独立失败，批处理继续。
        if result.destination and result.destination.exists():
            result.destination.unlink()
        result.error = str(error)
    return result


def compress_folder(
    input_folder: str | Path,
    output_folder: str | Path,
    settings: CompressionSettings = CompressionSettings(),
    progress: ProgressCallback | None = None,
) -> BatchSummary:
    settings = settings.normalized()
    input_dir = Path(input_folder).expanduser().resolve()
    output_dir = Path(output_folder).expanduser().resolve()
    if not input_dir.is_dir():
        raise ValueError("输入文件夹不存在")
    if input_dir == output_dir:
        raise ValueError("输出文件夹不能与输入文件夹相同，以免覆盖原图")

    files = discover_images(input_dir, output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    reserved: set[Path] = set()
    summary = BatchSummary()
    for index, source in enumerate(files, start=1):
        item = compress_one(source, input_dir, output_dir, settings, reserved)
        summary.results.append(item)
        if progress:
            progress(index, len(files), item)
    return summary


def format_bytes(value: int) -> str:
    units = ["B", "KiB", "MiB", "GiB"]
    amount = float(value)
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            return f"{amount:.2f} {unit}"
        amount /= 1024
    return f"{value} B"


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="批量等比压缩图片")
    parser.add_argument("input", help="输入文件夹")
    parser.add_argument("output", help="输出文件夹（不能与输入文件夹相同）")
    parser.add_argument("--max-edge", type=int, default=360)
    parser.add_argument("--quality", type=int, default=55)
    parser.add_argument("--format", default="WEBP", choices=["WEBP", "PNG", "JPEG"])
    parser.add_argument("--no-keep-smaller", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)
    summary = compress_folder(
        args.input,
        args.output,
        CompressionSettings(args.max_edge, args.quality, args.format, not args.no_keep_smaller),
        lambda current, total, item: print(f"[{current}/{total}] {'OK' if item.success else 'FAIL'} {item.source}"),
    )
    print(
        f"完成：成功 {len(summary.succeeded)}，失败 {len(summary.failed)}；"
        f"{format_bytes(summary.bytes_before)} → {format_bytes(summary.bytes_after)}，"
        f"减少 {summary.reduction_percent:.2f}%"
    )
    for item in summary.failed:
        print(f"失败：{item.source}：{item.error}")
    return 0 if not summary.failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
