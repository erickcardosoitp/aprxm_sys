// ============================================================
// APRXM — Domain Types
// ============================================================

export type UserRole = 'superadmin' | 'admin' | 'conferente' | 'operator' | 'viewer'

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
  amount: string
  description: string
  transaction_at: string
  is_sangria: boolean
  category_id?: string
  resident_id?: string
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

  responsible_id?: string
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
  sender_name?: string
  has_delivery_fee: boolean
  delivery_fee_amount?: string
  received_at: string
  delivered_at?: string
  resident_id?: string
  resident_name?: string
  resident_cep?: string
  resident_phone?: string
  resident_type?: string
}

// --- Service Orders ---

export type ServiceOrderStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled'
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
  created_at: string
}

// --- Settings ---

export interface AssociationSettings {
  association_id: string
  default_cash_balance: string
  max_cash_before_sangria: string
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
