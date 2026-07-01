import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(new Date(date))
}

export function formatTime(date: string | Date) {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function getStatusBadgeClass(status: string) {
  switch (status?.toLowerCase()) {
    case 'hadir': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'izin': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'sakit': return 'bg-red-100 text-red-700 border-red-200'
    case 'alfa': return 'bg-slate-100 text-slate-600 border-slate-200'
    case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'approved': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'rejected': return 'bg-red-100 text-red-700 border-red-200'
    case 'active': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'expired': return 'bg-slate-100 text-slate-500 border-slate-200'
    default: return 'bg-slate-100 text-slate-600 border-slate-200'
  }
}

export function getStatusIcon(status: string) {
  switch (status?.toLowerCase()) {
    case 'hadir': return '✅'
    case 'izin': return '📋'
    case 'sakit': return '🤒'
    case 'alfa': return '❌'
    default: return '—'
  }
}

export function getRoleBadgeClass(role: string) {
  switch (role?.toLowerCase()) {
    case 'superadmin': return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'supervisor': return 'bg-purple-100 text-purple-700 border-purple-200'
    case 'leader': return 'bg-indigo-100 text-indigo-700 border-indigo-200'
    case 'cleaner': return 'bg-green-100 text-green-700 border-green-200'
    case 'housekeeping': return 'bg-teal-100 text-teal-700 border-teal-200'
    case 'gardener': return 'bg-lime-100 text-lime-700 border-lime-200'
    case 'gondola': return 'bg-orange-100 text-orange-700 border-orange-200'
    default: return 'bg-slate-100 text-slate-600 border-slate-200'
  }
}
