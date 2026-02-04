import hotToast from "react-hot-toast"
import type { ToastOptions } from "react-hot-toast"
import { CheckCircle, AlertCircle, AlertTriangle } from "lucide-react"

const iconStyle = { width: 20, height: 20, minWidth: 20 }

const successIcon = <CheckCircle style={iconStyle} className="text-emerald-600" />
const errorIcon = <AlertCircle style={iconStyle} className="text-red-500" />
const warningIcon = <AlertTriangle style={iconStyle} className="text-amber-500" />

function success(message: string, opts?: ToastOptions) {
  return hotToast(message, { icon: successIcon, ...opts })
}

function error(message: string, opts?: ToastOptions) {
  return hotToast(message, { icon: errorIcon, ...opts })
}

function warning(message: string, opts?: ToastOptions) {
  return hotToast(message, { icon: warningIcon, ...opts })
}

const toast = Object.assign(hotToast, {
  success,
  error,
  warning,
})

export { successIcon, errorIcon, warningIcon }
export default toast
