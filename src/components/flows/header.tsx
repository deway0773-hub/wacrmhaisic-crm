"use client";

/**
 * Editor toolbar — flow name / description, status chip, dirty
 * indicator, and the action buttons (Save, Activate/Pause, Delete,
 * View runs, Back).
 *
 * Restyled to the Flow Builder design handoff: a single compact
 * toolbar row (back · icon · inline-editable name · status chip ·
 * edited dot on the left; Runs · Delete · Activate · Save on the
 * right) followed by a subtle, full-width description "note" line.
 * Replaces the old three-row stack so the editor reads as one app
 * chrome bar above the canvas/list stage.
 *
 * Lifted out of flow-builder.tsx so the same toolbar renders above
 * both views in FlowEditorShell. Without this, canvas users had no
 * way to save without toggling to list view.
 *
 * Reads everything from the editor context (`useFlowEditor`) so it
 * stays in sync with whichever view is mutating state, and routes
 * router navigation locally (back to /flows, View runs to
 * /flows/[id]/runs) — those don't belong in the hook.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CircleDot,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  useFlowEditor,
  type BuilderState,
} from "./flow-editor-state";

export function EditorHeader() {
  const router = useRouter();
  const t = useTranslations("Flows.builder");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const {
    flow,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    deleteFlow,
  } = useFlowEditor();

  return (
    <div className="flex flex-col gap-1.5 px-6 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* ---- left: back · icon · name · status · edited ---- */}
        <button
          type="button"
          onClick={() => router.push("/flows")}
          title="返回流程"
          aria-label="返回流程"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Workflow className="h-[18px] w-[18px]" />
        </span>
        <input
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder="流程名称"
          spellCheck={false}
          aria-label="流程名称"
          className="min-w-[120px] max-w-[340px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-bold leading-tight tracking-tight text-foreground outline-none transition-colors hover:bg-muted focus:border-primary focus:bg-transparent focus:shadow-[0_0_0_3px_var(--primary-soft)]"
        />
        <StatusChip status={state.status} />
        {dirty && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
            title="有未保存的更改，请点击保存以持久化"
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            已编辑
          </span>
        )}

        {/* ---- right: runs · delete · activate · save ---- */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/flows/${flow.id}/runs`)}
          >
            <History className="h-3.5 w-3.5" />
            运行记录
            <span className="ml-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {flow.execution_count}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
          {state.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("draft")}
              disabled={activating}
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              暂停
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("active")}
              disabled={activating || !canActivate}
              title={
                !canActivate
                  ? "激活前请先修复以下问题"
                  : undefined
              }
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              激活
            </Button>
          )}
          <Button onClick={() => void save()} disabled={saving} size="sm">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            保存
          </Button>
        </div>
      </div>

      {/* ---- description note (subtle, inline-editable) ---- */}
      <input
        value={state.description}
        onChange={(e) =>
          setState((s) => ({ ...s, description: e.target.value }))
        }
        placeholder="添加简短描述（内部使用，客户不可见）"
        aria-label="流程描述"
        className="w-full max-w-[78ch] rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/50 focus:border-primary focus:bg-transparent focus:text-foreground"
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteFlow()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusChip({ status }: { status: BuilderState["status"] }) {
  const t = useTranslations("Flows.list");
  const cfg = {
    draft: {
      // Neutral, not amber — amber is reserved for the adjacent
      // "Edited" dirty signal, so the two don't read as the same alert.
      cls: "border-border bg-muted text-muted-foreground",
      label: t("statusDraft"),
    },
    active: {
      cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
      label: t("statusActive"),
    },
    archived: {
      cls: "border-border bg-muted/50 text-muted-foreground",
      label: t("statusArchived"),
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
        cfg.cls,
      )}
    >
      <CircleDot className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
