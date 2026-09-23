'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, isRealtimeHealthy, describeRealtimeStatus } from '@/lib/supabase/client';
import type { RealtimeStatus } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { CustomField } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a field is created/renamed/deleted so the caller can
   *  refresh anything derived from the field catalogue (e.g. the
   *  contacts table's dynamic columns). */
  onFieldsChanged?: () => void;
}

/**
 * Dialog wrapper around {@link CustomFieldsPanel}, used on the Contacts page.
 * The same panel is rendered inline under Settings → Custom Fields, so the
 * editing UI lives in one place. Radix unmounts the dialog content on close,
 * so the panel remounts (and refetches) on each open.
 */
export function CustomFieldsManager({
  open,
  onOpenChange,
  onFieldsChanged,
}: CustomFieldsManagerProps) {
  const t = useTranslations('Contacts.customFields');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('desc')}
          </DialogDescription>
        </DialogHeader>
        <CustomFieldsPanel onFieldsChanged={onFieldsChanged} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Create / rename / delete account-wide custom contact field definitions.
 * Per-contact values are edited elsewhere (contact detail → Custom Fields);
 * this only manages the field catalogue. Admin+ gated by the caller — the
 * `custom_fields` RLS also rejects non-admin writes as defense in depth.
 */
export function CustomFieldsPanel({
  onFieldsChanged,
}: {
  onFieldsChanged?: () => void;
} = {}) {
  const t = useTranslations('Contacts.customFields');
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomField | null>(null);

  // Realtime is a *nice-to-have* here: the list is always loaded with a
  // plain `select()` first, so a dead websocket must never leave the panel
  // stuck on "no fields yet". We only warn once per mount to avoid spamming
  // the console/toast on every reconnect attempt.
  const realtimeWarned = useRef(false);

  const fetchFields = useCallback(async () => {
    console.log('accountId', accountId);
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('account_id', accountId)
      .order('field_name');
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    let rows = (data as CustomField[] | null) ?? [];

    // Fallback: if the account-scoped query came back empty, look for
    // rows with a NULL / mismatched account_id (legacy dirty data) so
    // the user can see them instead of a misleading "no fields yet".
    if (rows.length === 0) {
      const { data: allData, error: allError } = await supabase
        .from('custom_fields')
        .select('*')
        .order('field_name');
      if (allError) {
        toast.error(allError.message);
        setLoading(false);
        return;
      }
      const all = (allData as CustomField[] | null) ?? [];
      const orphans = all.filter((f) => f.account_id !== accountId);
      if (orphans.length > 0) {
        toast.warning(t('toastOrphanFields', { count: orphans.length }));
        rows = all;
      }
    }

    setFields(rows);
    setLoading(false);
  }, [supabase, accountId, t]);

  // Load the field list on mount once the account is known. The setters
  // inside fetchFields run after the Supabase await — not synchronously in
  // the effect body — so the cascade the lint rule warns about doesn't apply.
  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFields();
    }
  }, [accountId, fetchFields]);

  // Incremental refresh only. If Realtime is unavailable (table not added to
  // the publication, websocket blocked, …) we log + toast once and carry on
  // with the data the initial `select()` already loaded.
  useEffect(() => {
    if (!accountId) return;

    const channel = supabase
      .channel(`custom_fields:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'custom_fields',
          filter: `account_id=eq.${accountId}`,
        },
        () => {
          void fetchFields();
        }
      )
      .subscribe((status) => {
        const realtimeStatus = status as RealtimeStatus;
        console.log('[custom_fields] realtime status:', realtimeStatus);
        if (isRealtimeHealthy(realtimeStatus)) {
          realtimeWarned.current = false;
          return;
        }
        if (realtimeWarned.current) return;
        realtimeWarned.current = true;
        console.warn(
          `[custom_fields] realtime unavailable (${realtimeStatus}): ${describeRealtimeStatus(realtimeStatus)}`
        );
        toast.warning(t('toastRealtimeUnavailable'));
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, accountId, fetchFields, t]);

  /** Case-insensitive name clash within the loaded list. */
  function isDuplicate(name: string, exceptId?: string): boolean {
    const lower = name.toLowerCase();
    return fields.some(
      (f) => f.id !== exceptId && f.field_name.toLowerCase() === lower
    );
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (!accountId || !user) {
      toast.error(t('toastNoAccount'));
      return;
    }
    if (isDuplicate(name)) {
      toast.error(t('toastDuplicate', { name }));
      return;
    }

    setCreating(true);
    const { error } = await supabase.from('custom_fields').insert({
      field_name: name,
      field_type: 'text',
      user_id: user.id,
      account_id: accountId,
    });
    setCreating(false);

    if (error) {
      toast.error(t('toastCreateFailed'));
      return;
    }
    toast.success(t('toastCreated', { name }));
    setNewName('');
    await fetchFields();
    onFieldsChanged?.();
  }

  /** Returns true on success so the row can keep the new name, false so it
   *  reverts to the previous one. No-ops (blank / unchanged) count as success. */
  async function handleRename(
    field: CustomField,
    nextName: string
  ): Promise<boolean> {
    const name = nextName.trim();
    if (!name || name === field.field_name) return true;
    if (isDuplicate(name, field.id)) {
      toast.error(t('toastDuplicate', { name }));
      return false;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .update({ field_name: name })
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastRenameFailed'));
      return false;
    }
    await fetchFields();
    onFieldsChanged?.();
    return true;
  }

  async function handleDelete(field: CustomField) {
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastDeleteFailed'));
      return;
    }
    toast.success(t('toastDeleted', { name: field.field_name }));
    await fetchFields();
    onFieldsChanged?.();
  }

  return (
    <div className="space-y-4">
      {/* Create */}
      <div className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCreate();
            }
          }}
          placeholder={t('fieldName')}
          className="h-10 bg-muted pl-3 text-foreground"
        />
        <Button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="bg-primary hover:bg-primary/90 text-primary-foreground h-10 shrink-0"
        >
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {t('addField')}
        </Button>
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : fields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {fields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                busy={busyId === field.id}
                onRename={handleRename}
                onDelete={setPendingDelete}
              />
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm', { name: pendingDelete?.field_name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="w-auto">{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) void handleDelete(target);
              }}
              className="w-auto bg-red-600 text-white hover:bg-red-700"
            >
              {t('deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A single editable row. Controlled local state lets us commit on blur /
 *  Enter and cleanly revert to the last saved name when a rename fails. */
function FieldRow({
  field,
  busy,
  onRename,
  onDelete,
}: {
  field: CustomField;
  busy: boolean;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
}) {
  const t = useTranslations('Contacts.customFields');
  const [name, setName] = useState(field.field_name);

  async function commit() {
    if (name.trim() === field.field_name) {
      setName(field.field_name); // normalise any whitespace-only edit
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
  }

  return (
    <li className="flex h-10 items-center gap-2 px-3">
      <Input
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        aria-label={t('renameAria', { name: field.field_name })}
        className="focus:border-primary h-10 border-transparent bg-transparent text-foreground hover:border-border"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onClick={() => onDelete(field)}
        title={t('deleteTitle')}
        className="shrink-0 text-muted-foreground hover:text-red-400"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
    </li>
  );
}
