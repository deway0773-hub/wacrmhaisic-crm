"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * heroicons v2 outline: eye (20x20, stroke 1.5)
 *
 * 全站唯一的密码可见性图标。刻意不提供 EyeOff / eye-slash 变体：
 * 切换明文/密文时图标形状保持不变，只用透明度表达状态，
 * 避免出现用户不喜欢的“斜线”。
 */
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 20 20"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M1.697 10.268a.833.833 0 0 1 0-.536C2.854 6.258 6.16 3.75 10 3.75s7.146 2.508 8.303 5.982a.833.833 0 0 1 0 .536C17.146 13.742 13.84 16.25 10 16.25s-7.146-2.508-8.303-5.982Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"
      />
    </svg>
  );
}

export interface PasswordInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  /** 初始是否明文显示。默认 `false`（密文）。 */
  defaultVisible?: boolean;
  /** 受控的可见性（传入后需配合 `onVisibleChange`）。 */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  /** 图标按钮的额外类名。 */
  toggleClassName?: string;
}

/**
 * 带“小眼睛”切换的密码输入框。
 *
 * - 图标固定为单个 `Eye`，切换时只改 `opacity-40` / `opacity-100`。
 * - 输入框自动补 `pr-10`，避免文字被图标遮挡。
 * - 其余 props 透传给底层 `Input`。
 */
export function PasswordInput({
  className,
  defaultVisible = false,
  visible,
  onVisibleChange,
  toggleClassName,
  ...props
}: PasswordInputProps) {
  const [internalVisible, setInternalVisible] = React.useState(defaultVisible);
  const isControlled = visible !== undefined;
  const shown = isControlled ? visible : internalVisible;

  const toggle = React.useCallback(() => {
    const nextValue = !shown;
    if (!isControlled) setInternalVisible(nextValue);
    onVisibleChange?.(nextValue);
  }, [isControlled, onVisibleChange, shown]);

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={toggle}
        tabIndex={-1}
        aria-label={shown ? "隐藏密码" : "显示密码"}
        title={shown ? "点击隐藏" : "点击显示"}
        className={cn(
          "absolute right-3 top-1/2 -translate-y-1/2 border-0 bg-transparent p-0 text-gray-400 transition-opacity hover:text-gray-600",
          shown ? "opacity-100" : "opacity-40",
          toggleClassName
        )}
      >
        <EyeIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
