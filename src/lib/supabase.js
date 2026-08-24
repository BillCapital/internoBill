import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://qibxnwlrbartrlfycqmv.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_769JWGN6oHoVnz5CpAr35Q_cMvDATeP'

export const SUPABASE_URL = url
export const supabase = createClient(url, key)
