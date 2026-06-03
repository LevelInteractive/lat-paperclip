import { useState, useMemo } from "react";
import { PROJECT_ICON_NAMES, type ProjectIconName } from "@paperclipai/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PROJECT_ICONS, getProjectIcon } from "../lib/project-icons";

const DEFAULT_ICON: ProjectIconName = "folder";

interface ProjectIconProps {
  icon: string | null | undefined;
  className?: string;
}

export function ProjectIcon({ icon, className }: ProjectIconProps) {
  const Icon = getProjectIcon(icon);
  return <Icon className={className} />;
}

interface ProjectIconPickerProps {
  value: string | null | undefined;
  onChange: (icon: string) => void;
  children: React.ReactNode;
}

export function ProjectIconPicker({ value, onChange, children }: ProjectIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const entries = PROJECT_ICON_NAMES.map((name) => [name, PROJECT_ICONS[name]] as const);
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter(([name]) => name.includes(q));
  }, [search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <Input
          placeholder="Search icons..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 h-8 text-sm"
          autoFocus
        />
        <div className="grid grid-cols-7 gap-1 max-h-48 overflow-y-auto">
          {filtered.map(([name, Icon]) => (
            <button
              key={name}
              onClick={() => {
                onChange(name);
                setOpen(false);
                setSearch("");
              }}
              className={cn(
                "flex items-center justify-center h-8 w-8 rounded hover:bg-accent transition-colors",
                (value ?? DEFAULT_ICON) === name && "bg-accent ring-1 ring-primary"
              )}
              title={name}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-7 text-xs text-muted-foreground text-center py-2">No icons match</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
