import {
  Clock,
  DoorOpen,
  Gauge,
  House,
  KeyRound,
  MessageSquare,
  MessagesSquare,
  ScanFace,
  Settings,
  Video,
  type LucideIcon,
} from "lucide-react";

export type NavLink = { href: string; label: string; icon: LucideIcon };

// The four a caregiver checks most sit in the phone's tab bar; the rest go
// under More. The desktop sidebar shows all of them.
export const PRIMARY_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/dashboard/items", label: "Items", icon: KeyRound },
  { href: "/dashboard/questions", label: "Questions", icon: MessagesSquare },
  { href: "/dashboard/live", label: "Live", icon: Video },
];

export const SECONDARY_LINKS: NavLink[] = [
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
  { href: "/dashboard/people", label: "Faces", icon: ScanFace },
  { href: "/dashboard/rooms", label: "Rooms", icon: DoorOpen },
  { href: "/dashboard/recordings", label: "Recordings", icon: Clock },
  { href: "/dashboard/latency", label: "Latency", icon: Gauge },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string) {
  // Home is the prefix of every other page, so it only matches itself.
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
