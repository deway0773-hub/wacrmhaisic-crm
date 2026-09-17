'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { ACCOUNT_NAME_RE } from '@/lib/auth/account-name'

export function CreateMemberDialog({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', account: '', password: '', role: '销售' })

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('请输入姓名'); return }
    const account = form.account.trim()
    if (!account) { toast.error('请输入账号'); return }
    // Mirror the server-side rule so the user gets instant feedback
    // instead of a round-trip 400. A value with `@` is a real email
    // and skips the account-name charset check.
    if (!account.includes('@') && !ACCOUNT_NAME_RE.test(account)) {
      toast.error('账号只能包含字母、数字、点、下划线或短横线，长度 3-32 位')
      return
    }
    if (form.password.length < 6) { toast.error('密码至少需要 6 位'); return }
    setLoading(true)
    try {
      const roleMap: Record<string, string> = { '销售': 'agent', '管理': 'admin' }
      const payload: Record<string, string> = {
        name: form.name,
        account,
        password: form.password,
        role: roleMap[form.role] || 'agent',
      }
      const res = await fetch('/api/account/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建失败')
      toast.success('创建成功')
      setOpen(false)
      setForm({ name: '', account: '', password: '', role: '销售' })
      onCreated?.()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '创建失败')
    }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="bg-purple-600 hover:bg-purple-700 rounded-full" />}
      >
        + 创建成员
      </DialogTrigger>
      <DialogContent className="sm:max-w-md rounded-2xl p-6">
        <DialogHeader><DialogTitle>创建成员</DialogTitle></DialogHeader>
        <div className="space-y-6 pt-3">
          <div className="space-y-2">
            <Label>姓名 *</Label>
            <Input className="h-11 rounded-xl" placeholder="销售小张" autoComplete="off" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
          </div>
          <div className="space-y-2">
            <Label>账号 *</Label>
            <Input
              className="h-11 rounded-xl"
              type="text"
              placeholder="输入账号"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={form.account}
              onChange={e=>setForm({...form,account:e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label>密码 *</Label>
            <Input className="h-11 rounded-xl" type="password" placeholder="至少 6 位" autoComplete="new-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
          </div>
          <div className="space-y-2">
            <Label>角色</Label>
            <Select value={form.role} onValueChange={v=>setForm({...form,role:v ?? '销售'})}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="销售">销售</SelectItem>
                <SelectItem value="管理">管理</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full h-11 rounded-xl bg-purple-600 hover:bg-purple-700" onClick={handleCreate} disabled={loading}>{loading?'创建中...':'创建成员'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}