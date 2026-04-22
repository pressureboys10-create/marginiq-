import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { insertJobSchema, type InsertJob, LEAD_SOURCES } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DollarSign } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editJob?: InsertJob & { id: number };
}

const JOB_CATEGORIES = [
  "Landscaping", "Painting", "Cleaning", "Roofing", "Plumbing",
  "Electrical", "Carpentry", "HVAC", "Concrete", "Other"
];

const schema = insertJobSchema.extend({
  jobPrice: insertJobSchema.shape.jobPrice.min(0.01, "Price must be > 0"),
});

export default function AddJobDialog({ open, onOpenChange, editJob }: Props) {
  const { toast } = useToast();
  const isEdit = !!editJob;

  const form = useForm<InsertJob>({
    resolver: zodResolver(schema),
    defaultValues: editJob ?? {
      name: "",
      client: "",
      date: new Date().toISOString().slice(0, 10),
      jobPrice: 0,
      supplyCost: 0,
      laborCost: 0,
      gasCost: 0,
      equipmentCost: 0,
      otherCost: 0,
      notes: "",
      category: "",
      leadSource: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertJob) => {
      if (isEdit) {
        return apiRequest("PATCH", `/api/jobs/${editJob!.id}`, data);
      }
      return apiRequest("POST", "/api/jobs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: isEdit ? "Job updated" : "Job saved", description: form.getValues("name") });
      onOpenChange(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Could not save job.", variant: "destructive" });
    },
  });

  const onSubmit = (data: InsertJob) => mutation.mutate(data);

  const MoneyInput = ({ name, label }: { name: keyof InsertJob; label: string }) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground">{label}</FormLabel>
          <FormControl>
            <div className="relative">
              <DollarSign size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                {...field}
                type="number"
                min={0}
                step={0.01}
                className="pl-7 tabular-nums"
                data-testid={`input-${name}`}
                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
              />
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Job" : "New Job"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name + Client */}
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Job Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Smith backyard cleanup" data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="client" render={({ field }) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} placeholder="Client name" data-testid="input-client" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" data-testid="input-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Category */}
            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    value={field.value ?? ""}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="select-category"
                  >
                    <option value="">Select category...</option>
                    {JOB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Lead Source */}
            <FormField control={form.control} name="leadSource" render={({ field }) => (
              <FormItem>
                <FormLabel>Lead Source</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    value={field.value ?? ""}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="select-lead-source"
                  >
                    <option value="">How did they find you?</option>
                    {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Price */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Job Price</p>
              <MoneyInput name="jobPrice" label="Total Price Charged to Customer" />
            </div>

            {/* Costs */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Cost Breakdown</p>
              <div className="grid grid-cols-2 gap-3">
                <MoneyInput name="supplyCost" label="Supplies / Materials" />
                <MoneyInput name="laborCost" label="Labor" />
                <MoneyInput name="gasCost" label="Gas / Travel" />
                <MoneyInput name="equipmentCost" label="Equipment / Rental" />
                <MoneyInput name="otherCost" label="Other Costs" />
              </div>
            </div>

            {/* Live margin preview */}
            <LiveMarginPreview form={form} />

            {/* Notes */}
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ""} placeholder="Any additional notes..." rows={2} data-testid="textarea-notes" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save">
                {mutation.isPending ? "Saving..." : isEdit ? "Update Job" : "Save Job"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LiveMarginPreview({ form }: { form: ReturnType<typeof useForm<InsertJob>> }) {
  const values = form.watch();
  const price = values.jobPrice || 0;
  const totalCost = (values.supplyCost || 0) + (values.laborCost || 0) + (values.gasCost || 0) + (values.equipmentCost || 0) + (values.otherCost || 0);
  const profit = price - totalCost;
  const margin = price > 0 ? (profit / price) * 100 : 0;

  const colorClass = margin >= 30 ? "text-green-400" : margin >= 15 ? "text-yellow-400" : margin > 0 ? "text-orange-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-border bg-secondary/50 p-3 flex items-center justify-between gap-4">
      <div className="text-center">
        <div className="stat-label">Total Cost</div>
        <div className="stat-value text-lg tabular-nums">${totalCost.toFixed(2)}</div>
      </div>
      <div className="text-center">
        <div className="stat-label">Profit</div>
        <div className={`stat-value text-lg tabular-nums ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
          {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
        </div>
      </div>
      <div className="text-center">
        <div className="stat-label">Margin</div>
        <div className={`stat-value text-lg tabular-nums ${colorClass}`}>{margin.toFixed(1)}%</div>
      </div>
    </div>
  );
}
