import {
  Clock,
  DoorOpen,
  Gauge,
  KeyRound,
  MessageSquare,
  MessagesSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavLink = { href: string; label: string; icon: LucideIcon };

// The ones a caregiver checks most sit in the phone's tab bar; the rest go
// under More. The desktop sidebar shows all of them.
export const PRIMARY_LINKS: NavLink[] = [
  { href: "/dashboard/items", label: "Items", icon: KeyRound },
  { href: "/dashboard/questions", label: "Questions", icon: MessagesSquare },
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
];

export const SECONDARY_LINKS: NavLink[] = [
  { href: "/dashboard/rooms", label: "Rooms", icon: DoorOpen },
  { href: "/dashboard/recordings", label: "Recordings", icon: Clock },
  { href: "/dashboard/latency", label: "Latency", icon: Gauge },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
