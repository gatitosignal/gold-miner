"""Tkinter 图形界面。"""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from compressor import CompressionSettings, compress_folder, format_bytes


PRESETS = {
    "极速手机模式（320px / 45）": (320, 45),
    "推荐手机模式（360px / 55）": (360, 55),
    "清晰模式（600px / 70）": (600, 70),
}


class CompressorApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("图片批量压缩工具")
        self.root.geometry("780x610")
        self.root.minsize(700, 540)
        self.events: queue.Queue = queue.Queue()

        self.input_var = tk.StringVar()
        self.output_var = tk.StringVar()
        self.max_edge_var = tk.StringVar(value="360")
        self.quality_var = tk.StringVar(value="55")
        self.format_var = tk.StringVar(value="WebP")
        self.preset_var = tk.StringVar(value="推荐手机模式（360px / 55）")
        self.keep_smaller_var = tk.BooleanVar(value=True)
        self.status_var = tk.StringVar(value="请选择输入和输出文件夹")
        self.summary_var = tk.StringVar(value="尚未开始")

        self._build()
        self.root.after(100, self._drain_events)

    def _build(self) -> None:
        frame = ttk.Frame(self.root, padding=18)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(1, weight=1)
        frame.rowconfigure(9, weight=1)

        self._folder_row(frame, 0, "输入文件夹", self.input_var, self._choose_input)
        self._folder_row(frame, 1, "输出文件夹", self.output_var, self._choose_output)

        ttk.Label(frame, text="预设").grid(row=2, column=0, sticky="w", pady=7)
        preset = ttk.Combobox(frame, textvariable=self.preset_var, values=list(PRESETS), state="readonly")
        preset.grid(row=2, column=1, columnspan=2, sticky="ew", pady=7)
        preset.bind("<<ComboboxSelected>>", self._apply_preset)

        options = ttk.Frame(frame)
        options.grid(row=3, column=0, columnspan=3, sticky="ew", pady=7)
        options.columnconfigure((1, 3, 5), weight=1)
        ttk.Label(options, text="最长边（px）").grid(row=0, column=0, padx=(0, 6))
        ttk.Entry(options, textvariable=self.max_edge_var, width=10).grid(row=0, column=1, sticky="ew", padx=(0, 18))
        ttk.Label(options, text="质量（1-100）").grid(row=0, column=2, padx=(0, 6))
        ttk.Entry(options, textvariable=self.quality_var, width=10).grid(row=0, column=3, sticky="ew", padx=(0, 18))
        ttk.Label(options, text="输出格式").grid(row=0, column=4, padx=(0, 6))
        ttk.Combobox(options, textvariable=self.format_var, values=["WebP", "PNG", "JPEG"], state="readonly", width=10).grid(row=0, column=5, sticky="ew")

        ttk.Checkbutton(
            frame,
            text="压缩后更大时，在格式相同的情况下保留较小的原文件",
            variable=self.keep_smaller_var,
        ).grid(row=4, column=0, columnspan=3, sticky="w", pady=5)

        ttk.Label(
            frame,
            text="提示：预设主要用于照片和奖励内容，请勿直接用于游戏精灵、按钮或透明动画素材。",
            foreground="#9a4e00",
        ).grid(row=5, column=0, columnspan=3, sticky="w", pady=(2, 10))

        self.start_button = ttk.Button(frame, text="开始压缩", command=self._start)
        self.start_button.grid(row=6, column=0, columnspan=3, sticky="ew", pady=8)
        self.progress = ttk.Progressbar(frame, mode="determinate", maximum=100)
        self.progress.grid(row=7, column=0, columnspan=3, sticky="ew", pady=5)
        ttk.Label(frame, textvariable=self.status_var).grid(row=8, column=0, columnspan=3, sticky="w")

        log_frame = ttk.LabelFrame(frame, text="处理结果 / 失败原因", padding=8)
        log_frame.grid(row=9, column=0, columnspan=3, sticky="nsew", pady=10)
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=14, wrap="word", state="disabled")
        scroll = ttk.Scrollbar(log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        self.log.grid(row=0, column=0, sticky="nsew")
        scroll.grid(row=0, column=1, sticky="ns")

        ttk.Label(frame, textvariable=self.summary_var, font=("Microsoft YaHei UI", 10, "bold")).grid(
            row=10, column=0, columnspan=3, sticky="w"
        )

    def _folder_row(self, parent, row, label, variable, command) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=7)
        ttk.Entry(parent, textvariable=variable).grid(row=row, column=1, sticky="ew", padx=8, pady=7)
        ttk.Button(parent, text="选择…", command=command).grid(row=row, column=2, pady=7)

    def _choose_input(self) -> None:
        selected = filedialog.askdirectory(title="选择包含图片的输入文件夹")
        if not selected:
            return
        self.input_var.set(selected)
        if not self.output_var.get():
            source = Path(selected)
            self.output_var.set(str(source.parent / f"{source.name}_compressed"))

    def _choose_output(self) -> None:
        selected = filedialog.askdirectory(title="选择输出文件夹（建议新建空文件夹）")
        if selected:
            self.output_var.set(selected)

    def _apply_preset(self, _event=None) -> None:
        max_edge, quality = PRESETS[self.preset_var.get()]
        self.max_edge_var.set(str(max_edge))
        self.quality_var.set(str(quality))
        self.format_var.set("WebP")

    def _start(self) -> None:
        try:
            settings = CompressionSettings(
                max_edge=int(self.max_edge_var.get()),
                quality=int(self.quality_var.get()),
                output_format=self.format_var.get(),
                keep_smaller_original=self.keep_smaller_var.get(),
            ).normalized()
            input_dir = Path(self.input_var.get()).expanduser().resolve()
            output_dir = Path(self.output_var.get()).expanduser().resolve()
            if not input_dir.is_dir():
                raise ValueError("请选择有效的输入文件夹")
            if input_dir == output_dir:
                raise ValueError("输出文件夹不能与输入文件夹相同")
        except Exception as error:
            messagebox.showerror("参数错误", str(error))
            return

        self.start_button.configure(state="disabled")
        self.progress["value"] = 0
        self.status_var.set("正在扫描图片…")
        self.summary_var.set("处理中")
        self._set_log("")

        def worker() -> None:
            try:
                summary = compress_folder(
                    input_dir,
                    output_dir,
                    settings,
                    lambda current, total, item: self.events.put(("progress", current, total, item)),
                )
                self.events.put(("done", summary))
            except Exception as error:
                self.events.put(("fatal", str(error)))

        threading.Thread(target=worker, daemon=True).start()

    def _drain_events(self) -> None:
        try:
            while True:
                event = self.events.get_nowait()
                kind = event[0]
                if kind == "progress":
                    _, current, total, item = event
                    self.progress["value"] = (current / total * 100) if total else 100
                    self.status_var.set(f"正在处理 {current}/{total}：{item.source.name}")
                    if not item.success:
                        self._append_log(f"失败：{item.source}\n原因：{item.error}\n\n")
                    elif item.warning:
                        self._append_log(f"提示：{item.source.name}：{item.warning}\n")
                elif kind == "done":
                    summary = event[1]
                    self.progress["value"] = 100
                    self.status_var.set("压缩完成")
                    self.summary_var.set(
                        f"成功 {len(summary.succeeded)}，失败 {len(summary.failed)}；"
                        f"{format_bytes(summary.bytes_before)} → {format_bytes(summary.bytes_after)}；"
                        f"减少 {summary.reduction_percent:.2f}%"
                    )
                    if not summary.failed:
                        self._append_log("全部图片处理成功。\n")
                    self.start_button.configure(state="normal")
                elif kind == "fatal":
                    self.status_var.set("处理失败")
                    self.summary_var.set(event[1])
                    self._append_log(f"错误：{event[1]}\n")
                    self.start_button.configure(state="normal")
        except queue.Empty:
            pass
        self.root.after(100, self._drain_events)

    def _set_log(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.insert("end", text)
        self.log.configure(state="disabled")

    def _append_log(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")


def main() -> None:
    root = tk.Tk()
    try:
        ttk.Style(root).theme_use("vista")
    except tk.TclError:
        pass
    CompressorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
