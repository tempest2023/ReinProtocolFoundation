export type SignInMethod = 'magic-link' | 'code'
export type AdminSignInState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  email?: string
  method?: SignInMethod
  sendError?: string
  retryAt?: number
}
