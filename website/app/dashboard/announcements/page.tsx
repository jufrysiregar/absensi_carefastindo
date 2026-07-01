'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Trash2, Edit2, X, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'

interface Announcement {
  id: string
  title: string
  content: string
  target_role: string
  created_at: string
  is_active: boolean
  read_count: number
  total_target: number
}

const ROLES = ['All', 'Supervisor', 'Leader', 'Cleaner', 'Housekeeping', 'Gardener', 'Gondola']

export default function AnnouncementsPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ title: '', content: '', target_role: 'All' })
  const [editId, setEditId] = useState<string | null>(null)

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('announcements-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
        queryClient.invalidateQueries({ queryKey: ['announcements'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_reads' }, () => {
        queryClient.invalidateQueries({ queryKey: ['announcements'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, queryClient])

  // Get announcements with dynamic target and reads count calculations
  const { data: list = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: async () => {
      // 1. Fetch announcements
      const { data: announcementsData } = await supabase
        .from('announcements')
        .select('id, title, content, target_role, created_at, is_active')
        .order('created_at', { ascending: false })

      if (!announcementsData) return []

      // 2. Fetch all announcement reads
      const { data: readsData } = await supabase
        .from('announcement_reads')
        .select('announcement_id')

      // 3. Fetch all users to calculate total targets
      const { data: usersData } = await supabase
        .from('users')
        .select('id, role')

      return announcementsData.map((a: any) => {
        const reads = (readsData ?? []).filter((r: any) => r.announcement_id === a.id).length
        
        let total = 0
        if (a.target_role === 'All') {
          total = (usersData ?? []).length
        } else {
          total = (usersData ?? []).filter(
            (u: any) => u.role?.toLowerCase() === a.target_role?.toLowerCase()
          ).length
        }

        return {
          id: a.id,
          title: a.title,
          content: a.content,
          target_role: a.target_role,
          created_at: a.created_at,
          is_active: a.is_active,
          read_count: reads,
          total_target: total
        }
      })
    }
  })

  // Mutation for sending/updating announcement
  const sendAnnouncementMutation = useMutation({
    mutationFn: async (payload: { title: string; content: string; target_role: string; id?: string }) => {
      if (payload.id) {
        // Update
        const { error } = await supabase
          .from('announcements')
          .update({ 
            title: payload.title, 
            content: payload.content, 
            target_role: payload.target_role 
          })
          .eq('id', payload.id)
        if (error) throw error
      } else {
        // Insert
        const { error } = await supabase.from('announcements').insert({
          title: payload.title,
          content: payload.content,
          target_role: payload.target_role,
          is_active: true
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editId ? 'Pengumuman berhasil diupdate!' : 'Pengumuman berhasil dikirim!')
      setForm({ title: '', content: '', target_role: 'All' })
      setEditId(null)
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    },
    onError: (error: any) => {
      toast.error('Gagal mengirim: ' + error.message)
    }
  })

  // Mutation for deleting announcement
  const deleteAnnouncementMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('announcements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Pengumuman dihapus')
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
    },
    onError: (error: any) => {
      toast.error('Gagal menghapus: ' + error.message)
    }
  })

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Judul dan konten wajib diisi')
      return
    }
    sendAnnouncementMutation.mutate({ ...form, id: editId || undefined })
  }

  function startEdit(a: Announcement) {
    setEditId(a.id)
    setForm({ title: a.title, content: a.content, target_role: a.target_role })
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Pengumuman</h1>
        <p className="text-sm text-slate-500 mt-1">Buat dan kelola pengumuman untuk karyawan berdasarkan role.</p>
      </div>

      {/* Form */}
      <Card className={`shadow-sm transition-colors ${editId ? 'border-amber-200 bg-amber-50/30' : 'border-blue-100 bg-blue-50/30'}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {editId ? <><Edit2 className="w-4 h-4 text-amber-500" /> Edit Pengumuman</> : <><Send className="w-4 h-4 text-blue-500" /> Buat Pengumuman Baru</>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSend} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Judul Pengumuman</Label>
              <Input
                id="title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Contoh: Info Jadwal Libur Lebaran"
                className="bg-white text-slate-800"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="content">Isi Pengumuman</Label>
              <Textarea
                id="content"
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Detail informasi pengumuman..."
                rows={4}
                className="bg-white resize-none text-slate-800"
              />
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 items-end justify-between pt-2">
              <div className="space-y-2 w-full sm:w-1/3">
                <Label htmlFor="target_role">Target Role</Label>
                <Select value={form.target_role} onValueChange={v => setForm(f => ({ ...f, target_role: v as string }))}>
                  <SelectTrigger id="target_role" className="bg-white text-slate-800">
                    <SelectValue placeholder="Pilih Target" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex gap-2 w-full sm:w-auto">
                {editId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setEditId(null); setForm({ title: '', content: '', target_role: 'All' }) }}
                    className="w-full sm:w-auto"
                  >
                    <X className="w-4 h-4 mr-2" /> Batal
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={sendAnnouncementMutation.isPending}
                  className={`w-full sm:w-auto ${editId ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                >
                  {sendAnnouncementMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  {editId ? 'Update Pengumuman' : 'Kirim Pengumuman'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <Card className="shadow-sm overflow-hidden flex flex-col">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <CardTitle className="text-base">Daftar Pengumuman Terkirim</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[40%]">Informasi</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Keterbacaan</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-slate-400">
                      Belum ada pengumuman
                    </TableCell>
                  </TableRow>
                ) : (
                  list.map(a => (
                    <TableRow key={a.id} className={editId === a.id ? 'bg-amber-50/20' : ''}>
                      <TableCell>
                        <div className="font-semibold text-slate-700">{a.title}</div>
                        <div className="text-sm text-slate-500 truncate max-w-[300px] mt-0.5">{a.content}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          <Users className="w-3 h-3 mr-1" />{a.target_role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-500 text-sm whitespace-nowrap">
                        {new Date(a.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Progress value={a.total_target > 0 ? (a.read_count / a.total_target) * 100 : 0} className="w-[80px] h-2 bg-slate-100" />
                          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">{a.read_count} / {a.total_target}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => startEdit(a)} className="h-8 w-8 text-amber-500 hover:text-amber-600 hover:bg-amber-50">
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm('Yakin hapus pengumuman ini?')) {
                                deleteAnnouncementMutation.mutate(a.id)
                              }
                            }}
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

