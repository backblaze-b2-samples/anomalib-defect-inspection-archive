import Link from "next/link";
import { Camera, ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InspectionOverview } from "@/components/dashboard/inspection-overview";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Parts inspected, the review backlog, verdicts and archive growth across every line.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href="/review">
              <ClipboardCheck className="h-3.5 w-3.5" /> Review queue
            </Link>
          </Button>
          <Button asChild size="sm" className="h-8">
            <Link href="/upload">
              <Camera className="h-3.5 w-3.5" /> Capture part
            </Link>
          </Button>
        </div>
      </div>
      <InspectionOverview />
    </div>
  );
}
