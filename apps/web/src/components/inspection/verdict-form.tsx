"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import type { ReferenceLabel, Verdict } from "@anomalib-defect-inspection-archive/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { loadOperator, saveOperator } from "@/lib/operator-preference";
import { useRecordVerdict } from "@/lib/queries";

const verdictSchema = z.object({
  verdict: z.enum(["pass", "fail"], { message: "Choose Pass or Fail." }),
  operator: z.string().trim().min(1, "Who is recording this verdict?").max(64),
  note: z.string().max(500).optional(),
});

type VerdictValues = z.infer<typeof verdictSchema>;

interface VerdictFormProps {
  lineId: string;
  serial: string;
  /** Latest verdict, pre-selected when changing one. */
  current?: Verdict | null;
  /** Set when the part was captured as a labelled reference image. */
  reference?: ReferenceLabel | null;
  onDone?: () => void;
}

const REFERENCE_VERDICT: Record<ReferenceLabel, Verdict> = { normal: "pass", anomalous: "fail" };

/** Record (or change) an operator verdict. Earlier verdicts stay in history. */
export function VerdictForm({ lineId, serial, current, reference, onDone }: VerdictFormProps) {
  const mutation = useRecordVerdict(lineId, serial);
  const form = useForm<VerdictValues>({
    resolver: zodResolver(verdictSchema),
    defaultValues: { verdict: current ?? undefined, operator: "", note: "" },
  });
  // The review queue mounts a fresh form per part: prefill the operator this
  // browser last recorded with, after hydration (storage is client-only).
  useEffect(() => {
    const remembered = loadOperator();
    if (remembered && !form.getValues("operator")) form.setValue("operator", remembered);
  }, [form]);

  const picked = useWatch({ control: form.control, name: "verdict" });
  const contradictsReference = !!reference && !!picked && REFERENCE_VERDICT[reference] !== picked;

  const onSubmit = (values: VerdictValues) =>
    mutation.mutate(
      { verdict: values.verdict, operator: values.operator, note: values.note || null },
      {
        onSuccess: () => {
          saveOperator(values.operator);
          toast.success(`Recorded ${values.verdict} for ${serial}`);
          form.reset({ verdict: values.verdict, operator: values.operator, note: "" });
          onDone?.();
        },
        onError: (error) => toast.error(error.message),
      },
    );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {reference && (
          <p
            role={contradictsReference ? "alert" : undefined}
            className={`rounded-md border p-3 text-sm ${contradictsReference ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}
          >
            This part is a {reference === "normal" ? "known-good" : "known-defective"} reference image,
            already labelled at capture. A verdict replaces that label in the next training run
            {contradictsReference
              ? `: recording ${picked} moves it to the ${picked === "pass" ? "normal training" : "anomalous evaluation"} images.`
              : "."}
          </p>
        )}
        <FormField
          control={form.control}
          name="verdict"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Verdict</FormLabel>
              <FormControl>
                <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="pass" /> Pass
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="fail" /> Fail
                  </label>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="operator"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Operator</FormLabel>
              <FormControl>
                <Input placeholder="e.g. your initials" autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note (optional)</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="What did you see?" {...field} />
              </FormControl>
              <FormDescription>Stored with the verdict in B2; earlier verdicts are kept.</FormDescription>
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : current ? "Change verdict" : "Record verdict"}
        </Button>
      </form>
    </Form>
  );
}
