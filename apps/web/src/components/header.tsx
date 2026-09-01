import { OraculoLogo } from "@nexo/ui/components/logo";
import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";

export default function Header() {
  return (
    <header>
      <div className="flex flex-row items-center justify-between px-3 py-2">
        <Link to="/" className="flex items-center gap-2 text-lg font-medium tracking-tight">
          <OraculoLogo variant="full" size={20} />
        </Link>
        <ModeToggle />
      </div>
      <hr />
    </header>
  );
}
