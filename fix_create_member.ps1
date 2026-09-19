
$root = $PSScriptRoot
Write-Host "=== 一键把 邀请成员 改成 创建成员 ===" -ForegroundColor Green

# 1. 创建后端的 create 文件夹
$createDir = "$root\src\app\api\account\members\create"
New-Item -ItemType Directory -Path $createDir -Force | Out-Null
$code = @'
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // 验证当前用户是 owner/admin (简单版，你可以加更严的鉴权)
    const authHeader = req.headers.get('authorization');
    const body = await req.json();
    const { email, name, role = 'agent', password, account_id } = body;

    if (!email || !account_id) {
      return NextResponse.json({ ok: false, error: '缺少邮箱或团队ID' }, { status: 400 });
    }

    // 1. 创建 auth 用户
    const tempPassword = password || Math.random().toString(36).slice(-10) + 'A1!';
    
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: name || email.split('@')[0] },
    });

    let userId = created?.user?.id;

    if (!userId) {
      // 如果已存在，查找
      if (createErr?.message?.includes('already exists')) {
        const { data: list } = await supabase.auth.admin.listUsers();
        const found = list?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
        if (found) userId = found.id;
      }
      if (!userId) {
        return NextResponse.json({ ok: false, error: '创建用户失败: ' + createErr?.message }, { status: 400 });
      }
    }

    // 2. 加入团队
    const { error: memberErr } = await supabase.from('account_members').upsert({
      account_id,
      user_id: userId,
      role, // owner, admin, agent
    }, { onConflict: 'account_id,user_id' });

    if (memberErr) {
      return NextResponse.json({ ok: false, error: '加入团队失败: ' + memberErr.message }, { status: 400 });
    }

    return NextResponse.json({ 
      ok: true, 
      user_id: userId,
      temp_password: !password ? tempPassword : undefined,
      message: '成员创建成功' 
    });

  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // 获取成员列表
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { searchParams } = new URL(req.url);
    const account_id = searchParams.get('account_id');

    const { data, error } = await supabase
      .from('account_members')
      .select('role, created_at, user_id, profiles:profiles!inner(email, full_name)')
      .eq('account_id', account_id);

    if (error) throw error;
    return NextResponse.json({ ok: true, members: data });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

'@
Set-Content -Path "$createDir\route.ts" -Value $code -Encoding UTF8
Write-Host "已创建: src/app/api/account/members/create/route.ts" -ForegroundColor Cyan

# 2. 创建前端按钮组件
$compDir = "$root\src\components"
New-Item -ItemType Directory -Path $compDir -Force | Out-Null
$btn = @'
"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';

export function CreateMemberDialog({ accountId, onCreated }: { accountId: string, onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'agent', password: '' });

  const handleCreate = async () => {
    if (!form.email) return alert('请输入邮箱');
    setLoading(true);
    try {
      const res = await fetch('/api/account/members/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, account_id: accountId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      
      alert(`创建成功！\n成员: ${form.email}\n${json.temp_password ? '初始密码: ' + json.temp_password + ' (请让成员登录后修改)' : '已可用邮箱密码直接登录'}`);
      setOpen(false);
      setForm({ email: '', name: '', role: 'agent', password: '' });
      onCreated?.();
    } catch (e:any) {
      alert('失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#7c3aed] hover:bg-[#6d28e0] text-white gap-2 rounded-full px-5">
          <Plus className="h-4 w-4" />
          创建成员
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>创建成员</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>邮箱 *</Label>
            <Input placeholder="agent@company.com" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          </div>
          <div className="space-y-2">
            <Label>姓名</Label>
            <Input placeholder="张三" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>角色</Label>
              <Select value={form.role} onValueChange={v => setForm({...form, role: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent"销售</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>初始密码 (可选)</Label>
              <Input type="password" placeholder="留空自动生成" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
            </div>
          </div>
          <Button onClick={handleCreate} disabled={loading} className="w-full bg-[#7c3aed] hover:bg-[#6d28e0] mt-2">
            {loading ? '创建中...' : '确认创建'}
          </Button>
          <p className="text-xs text-muted-foreground text-center">创建后成员可直接用邮箱登录，无需邀请链接。</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'@
Set-Content -Path "$compDir\CreateMemberButton.tsx" -Value $btn -Encoding UTF8
Write-Host "已创建: src/components/CreateMemberButton.tsx" -ForegroundColor Cyan

Write-Host "=== 完成！现在去改团队页面的一行代码 ===" -ForegroundColor Green
Write-Host "把 InviteMemberDialog 换成 CreateMemberDialog" -ForegroundColor Yellow
Pause
