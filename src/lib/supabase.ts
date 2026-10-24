import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, key);

export type AppStatus = "draft" | "submitted" | "approved" | "rejected";

export type Application = {
  user_id: string;
  full_name: string | null;
  birth_date: string | null;
  phone: string | null;
  cccd_front_url: string | null;
  cccd_back_url: string | null;
  work_locations: string[];
  experience_years: string | null;
  equipment: string | null;
  languages: string[];
  work_model: string | null;
  style_description: string | null;
  specialty_tags: string[];
  experience_detail: string | null;
  bio: string | null;
  skill_makeup: boolean;
  skill_edit: boolean;
  selected_styles: string[];
  price_groups: unknown[];
  proof_link: string | null;
  banner_url: string | null;
  avatar_url: string | null;
  boards: { id?: string; name?: string; pins?: string[]; cover?: string; private?: boolean }[];
  standalone_pins: string[];
  agreed_terms: boolean;
  status: AppStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  admin_note: string | null;
  skill_rental?: boolean;
  rental_boards?: { id?: string; name?: string; pins?: string[]; cover?: string }[];
  rental_pins?: string[];
  bank_name?: string | null;
  bank_code?: string | null;
  bank_account?: string | null;
  bank_account_name?: string | null;
  created_at?: string;
};

export type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: string;
  onboarding_completed: boolean | null;
  banned_at?: string | null;
  ban_reason?: string | null;
  created_at?: string;
};
