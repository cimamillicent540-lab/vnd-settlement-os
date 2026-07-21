import { cn } from "@/lib/utils";
const variants = { green:"tag-green", blue:"tag-blue", amber:"tag-amber", red:"tag-red", gray:"tag-gray", violet:"tag-violet" } as const;
export function Badge({ children, variant = "gray", className }: { children: React.ReactNode; variant?: keyof typeof variants; className?: string }) {
  return <span className={cn("tag", variants[variant], className)}>{children}</span>;
}
