// ============================================================
// APRXM — Domain Types
// ============================================================

export type UserRole =
  | 'superadmin'
  | 'admin'
  | 'conferente'
  | 'diretoria_adjunta'
  | 'operator'
  | 'viewer'

export interface AuthState {
  token: string | null
  userId: string | null
  associationId: string | null
  role: UserRole | null
  fullName: string | null
}

// --- Users ---

export interface User {
  id: string
  full_name: string
  email: string
  phone?: string
  role: UserRole
  is_active: boolean
  last_login_at?: string
  created_at: string
}

// --- Finance ---

export type TransactionType = 'income' | 'expense' | 'sangria'
export type IncomeSubtype = 'proof_of_residence' | 'delivery_fee' | 'mensalidade' | 'other'
export type CashSessionStatus = 'open' | 'closed'

export interface CashSession {
  id: string
  status: CashSessionStatus
  opening_balance: string
  closing_balance?: string
  expected_balance?: string
  difference?: string
  opened_at: string
  closed_at?: string
  opened_by: string
}

export interface Transaction {
  id: string
  type: TransactionType
  income_subtype?: IncomeSubtype
  amount: string
  description: string
  transaction_at: string
  is_sangria: boolean
  category_id?: string
  resident_id?: string
  created_by?: string
}

export interface TransactionCategory {
  id: string
  name: string
  type: TransactionType
  color?: string
  is_active: boolean
}

export interface PaymentMethod {
  id: string
  name: string
  is_active: boolean
}

// --- Residents ---

export type ResidentType = 'member' | 'guest'
export type ResidentStatus = 'active' | 'inactive' | 'suspended'

export interface Resident {
  id: string
  type: ResidentType
  status: ResidentStatus
  full_name: string
  cpf?: string
  rg?: string
  date_of_birth?: string
  race?: string
  education_level?: string
  email?: string
  phone_primary?: string
  phone_secondary?: string
  unit?: string
  block?: string
  parking_spot?: string
  photo_url?: string
  responsible_id?: string

  address_cep?: string
  address_street?: string
  address_number?: string
  address_complement?: string
  address_city?: string
  address_state?: string

  address_rooms?: number
  address_location?: string
  address_access: string[]
  uses_public_transport?: boolean
  transport_distance?: string
  household_count?: number
  household_profiles: string[]
  internet_access?: string
  has_sewage?: boolean
  neighborhood_problems: string[]
  main_priority_request?: string

  ownership_type?: string
  move_in_date?: string
  move_out_date?: string
  is_member_confirmed: boolean
  wants_to_join?: boolean
  monthly_payment_day?: number

  terms_accepted: boolean
  lgpd_accepted: boolean
  notes?: string
  created_at: string
}

// --- Packages ---

export type PackageStatus = 'received' | 'notified' | 'delivered' | 'returned'

export interface Package {
  id: string
  status: PackageStatus
  unit?: string
  block?: string
  carrier_name?: string
  tracking_code?: string
  has_delivery_fee: boolean
  delivery_fee_amount?: string
  received_at: string
  delivered_at?: string
  resident_id?: string
  resident_name?: string
  resident_cpf?: string
  resident_cep?: string
  resident_phone?: string
  resident_type?: string
  photo_urls?: Array<{ url: string; label: string; taken_at: string }>
  notes?: string
  object_type?: string
  sender_name?: string
  delivered_to_name?: string
  delivered_to_cpf?: string
  deliverer_name?: string
  signature_url?: string
  proof_of_residence_url?: string
  deliverer_signature_url?: string
}

export interface PackageEvent {
  id: string
  event_type: string
  comment?: string
  attachment_url?: string
  attachment_name?: string
  created_at: string
  author_name: string
}

// --- Service Orders ---

export type ServiceOrderStatus =
  | 'pending'
  | 'open'
  | 'in_progress'
  | 'waiting_third_party'
  | 'resolved'
  | 'archived'
  | 'cancelled'

export type ServiceOrderPriority = 'low' | 'medium' | 'high' | 'critical'

export interface ServiceOrder {
  id: string
  number: number
  title: string
  description: string
  status: ServiceOrderStatus
  priority: ServiceOrderPriority
  area?: string
  unit?: string
  block?: string
  service_impacted?: string
  category_name?: string
  org_responsible?: string
  requester_name?: string
  requester_phone?: string
  requester_email?: string
  reference_point?: string
  address_cep?: string
  assigned_to?: string
  requester_resident_id?: string
  resolution_notes?: string
  resolved_at?: string
  cancellation_reason?: string
  request_date?: string
  created_at: string
  updated_at?: string
}

export interface SOComment {
  id: string
  comment: string
  attachment_urls: string[]
  created_at: string
  author_name: string
}

// --- Settings ---

export interface AssociationSettings {
  association_id: string
  default_cash_balance: string
  max_cash_before_sangria: string
}

export interface AssociationData {
  name: string
  phone: string
  email: string
  address: string
  cep: string
  president_user_id?: string
}

// --- Cash Session Summary ---

export interface CashSessionSummary {
  id: string
  status: string
  opening_balance: string
  closing_balance?: string
  expected_balance?: string
  difference?: string
  opened_at: string
  closed_at?: string
}
