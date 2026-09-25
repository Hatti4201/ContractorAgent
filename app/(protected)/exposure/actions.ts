"use server";

import type { Prisma } from "@/app/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { parseSettings } from "@/services/exposure-rules";
import { exposureState, loadExposureConfig, runExposure } from "@/services/exposure-run";

function done(notice?: string) {
  revalidatePath("/exposure");
  revalidatePath("/dashboard");
  redirect(notice ? `/exposure?notice=${notice}` : "/exposure");
}

async function saveSettings(changes: Record<string, unknown>) {
  // Only the settings fields are kept: parseSettings drops the derived ones (cdpUrl, window, jobDelayMs).
  const current = await loadExposureConfig();
  const next = parseSettings({ ...current, ...changes }, current);
  await exposureState();
  await getPrisma().exposureState.update({ where: { id: "primary" }, data: { settings: next as unknown as Prisma.InputJsonValue } });
}

export async function runExposureNow() {
  await requireAuth();
  // A run takes many minutes, so it continues after the response; the page follows its progress.
  after(() => runExposure().then(() => undefined));
  done();
}

export async function stopExposure() {
  await requireAuth();
  await exposureState();
  await getPrisma().exposureState.update({ where: { id: "primary" }, data: { stopRequested: true } });
  done();
}

/** "on" submits real applications, so it needs the separate confirmation box ticked (REQUIREMENTS FR-14). */
export async function setExposureMode(formData: FormData) {
  await requireAuth();
  const mode = String(formData.get("mode") ?? "");
  if (mode === "on" && formData.get("confirmOn") !== "yes") done("confirm-on");
  await saveSettings({ mode });
  done("saved");
}

export async function saveExposureSettings(formData: FormData) {
  await requireAuth();
  const text = (name: string) => String(formData.get(name) ?? "");
  await saveSettings({
    keywords: text("keywords"),
    postedDate: text("postedDate"),
    employmentTypes: formData.getAll("employmentTypes").map(String),
    pageRatio: Number(text("pagePercent")) / 100,
    maxPages: text("maxPages"),
    titleBlacklist: text("titleBlacklist"),
    companyBlacklist: text("companyBlacklist"),
    dailyLimit: text("dailyLimit"),
    perRunLimit: text("perRunLimit"),
    jobDelaySeconds: text("jobDelaySeconds"),
    days: formData.getAll("days").map(String),
    startHour: text("startHour"),
    endHour: text("endHour"),
    intervalMinutes: text("intervalMinutes"),
    maxConsecutiveFailures: text("maxConsecutiveFailures"),
    maxStepsPerJob: text("maxStepsPerJob"),
    executorModel: text("executorModel"),
    supervisorModel: text("supervisorModel"),
  });
  done("saved");
}
