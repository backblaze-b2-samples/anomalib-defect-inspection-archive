"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import type { Line } from "@anomalib-defect-inspection-archive/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useCreateLine, useUpdateLine } from "@/lib/queries";

const lineSchema = z.object({
  line_id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "2-41 lowercase letters, digits or dashes"),
  name: z.string().trim().min(1, "Give the line a name").max(120),
  description: z.string().max(500).optional(),
});

type LineValues = z.infer<typeof lineSchema>;

/** Create a line, or (with `line`) edit its name and description. */
export function LineFormDialog({ line }: { line?: Line }) {
  const [open, setOpen] = useState(false);
  const editing = !!line;
  const router = useRouter();
  const create = useCreateLine();
  const update = useUpdateLine(line?.line_id ?? "");
  const form = useForm<LineValues>({
    resolver: zodResolver(lineSchema),
    // Edit opens pre-filled; create starts empty with placeholder guidance.
    defaultValues: {
      line_id: line?.line_id ?? "",
      name: line?.name ?? "",
      description: line?.description ?? "",
    },
  });
  const pending = create.isPending || update.isPending;

  const onSubmit = (values: LineValues) => {
    const done = {
      onSuccess: () => {
        toast.success(editing ? "Line updated" : `Line ${values.line_id} created`);
        setOpen(false);
        if (!editing) {
          form.reset();
          // Next step on a new line is capturing its parts: open it.
          router.push(`/lines/${encodeURIComponent(values.line_id)}`);
        }
      },
      onError: (error: Error) => toast.error(error.message),
    };
    if (editing) {
      update.mutate({ name: values.name, description: values.description || null }, done);
    } else {
      create.mutate(
        { line_id: values.line_id, name: values.name, description: values.description || null },
        done,
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={editing ? "outline" : "default"} className="h-8">
          {editing ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {editing ? "Edit line" : "New line"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${line.line_id}` : "New inspection line"}</DialogTitle>
          <DialogDescription>
            A line groups part images, scores, verdicts and model versions under{" "}
            <code>lines/&lt;line-id&gt;/</code> in B2.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="line_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Line id</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. line-01" disabled={editing} autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>Part of every B2 key; it cannot change later.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Line 1, candle station" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="What is inspected here?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving..." : editing ? "Save changes" : "Create line"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
