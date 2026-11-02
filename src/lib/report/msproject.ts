import type { ActivityInput, ActivityResult, ProjectAnalysis, ProjectInput, ResourceInput } from "@/lib/engine/types";
import { isIsoDate } from "@/lib/engine/calendar";
import { escapeXml } from "./xml";

/** MSPDI dependency type codes: FF=0, FS=1, SF=2, SS=3. */
const LINK_TYPE: Record<string, number> = { FS: 1, FF: 0, SF: 2, SS: 3 };
/** MSPDI weekday codes: 1 = Sunday … 7 = Saturday. */
const DAY_TYPE: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7 };
const CONSTRAINT_TYPE: Record<string, number> = { ASAP: 0, MSO: 2, SNET: 4, FNLT: 7 };
const RESOURCE_TYPE: Record<ResourceInput["type"], number> = {
  labor: 0,
  equipment: 0,
  material: 1,
  cost: 2,
};

interface WorkWindow {
  start: string;
  finish: string;
}

function clockTime(totalMinutes: number): string {
  if (totalMinutes >= 24 * 60) return "23:59:59";
  const normalized = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

function workWindow(hoursPerDay: number): WorkWindow {
  const hours = Math.max(1, Math.min(24, Number.isFinite(hoursPerDay) ? hoursPerDay : 8));
  // Use a conventional 08:00 start for ordinary shifts. Longer shifts start at
  // midnight so the XML never emits invalid values such as 24:00 or 32:00.
  const startMinutes = hours <= 15 ? 8 * 60 : 0;
  const finishMinutes = startMinutes + Math.round(hours * 60);
  return { start: clockTime(startMinutes), finish: clockTime(finishMinutes) };
}

function dateTime(iso: string | undefined, time: string): string | undefined {
  return iso && isIsoDate(iso) ? `${iso}T${time}` : undefined;
}

function isoDuration(hours: number): string {
  const totalMinutes = Math.max(0, Math.round((Number.isFinite(hours) ? hours : 0) * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `PT${wholeHours}H${minutes}M`;
}

function numberXml(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Object.is(value, -0) ? "0" : String(value);
}

function taskNotes(activity: ActivityInput, unresolved: string[]): string {
  const parts = [activity.notes?.trim() ?? ""];
  if (activity.deliverable?.trim()) parts.push(`تحویل‌دادنی: ${activity.deliverable.trim()}`);
  if (unresolved.length) parts.push(`ارجاع‌های صادرنشده (شناسه نامعتبر): ${unresolved.join("، ")}`);
  return parts.filter(Boolean).join("\n");
}

/**
 * MSPDI/Project XML writer. The format represents the scheduling and resource
 * model; the companion Project.json is the lossless source for fields that
 * Microsoft Project does not model (e.g. HERMIPLAN risk and pricing settings).
 */
export function buildMsProjectXml(input: ProjectInput, analysis: ProjectAnalysis): string {
  const hours = input.calendar.hoursPerDay || 8;
  const window = workWindow(hours);
  const activityById = new Map<string, ActivityInput>();
  const activityResultById = new Map<string, ActivityResult>();
  const activityByCode = new Map<string, ActivityInput>();
  const resourceById = new Map(input.resources.map((resource) => [resource.id, resource]));
  for (const activity of input.activities) {
    if (!activityById.has(activity.id)) activityById.set(activity.id, activity);
    if (activity.code) activityByCode.set(activity.code, activity);
  }
  for (const result of analysis.activities) activityResultById.set(result.id, result);

  const phaseNames: string[] = [];
  for (const activity of input.activities) {
    if (!phaseNames.includes(activity.phase)) phaseNames.push(activity.phase);
  }

  interface TaskRow {
    uid: number;
    id: number;
    input?: ActivityInput;
    result?: ActivityResult;
    name: string;
    outline: number;
    outlineNumber: string;
    summary: boolean;
    wbs: string;
    start?: string;
    finish?: string;
    durationDays: number;
    progress: number;
    critical?: boolean;
    totalSlack?: number;
    freeSlack?: number;
    milestone: boolean;
    links: { uid: number; type: number; lag: number }[];
  }

  const rows: TaskRow[] = [];
  const uidOfActivity = new Map<string, number>();
  let nextUid = 1;
  for (const [phaseIndex, phaseName] of phaseNames.entries()) {
    const phaseUid = nextUid++;
    const phaseInfo = analysis.schedule.phases.find((phase) => phase.name === phaseName);
    rows.push({
      uid: phaseUid,
      id: rows.length + 1,
      name: phaseName,
      outline: 1,
      outlineNumber: String(phaseIndex + 1),
      summary: true,
      wbs: phaseInfo?.wbs ?? String(phaseIndex + 1),
      start: phaseInfo?.startDate,
      finish: phaseInfo?.finishDate,
      durationDays: phaseInfo?.duration ?? 0,
      progress: phaseInfo?.progress ?? 0,
      critical: phaseInfo?.critical,
      milestone: false,
      links: [],
    });

    for (const activity of input.activities.filter((item) => item.phase === phaseName)) {
      const result = activityResultById.get(activity.id);
      const activityUid = nextUid++;
      // Do not lose tasks that could not be scheduled because of a cycle or a
      // bad predecessor. Only calculated fields are omitted for those tasks.
      if (!uidOfActivity.has(activity.id)) uidOfActivity.set(activity.id, activityUid);
      rows.push({
        uid: activityUid,
        id: rows.length + 1,
        input: activity,
        result,
        name: activity.name,
        outline: 2,
        outlineNumber: result?.wbs ?? `${phaseIndex + 1}.${rows.length}`,
        summary: false,
        wbs: result?.wbs ?? "",
        start: result?.startDate,
        finish: result?.finishDate,
        durationDays: result?.duration ?? activity.duration,
        progress: activity.progress,
        critical: result?.critical,
        totalSlack: result?.totalFloat,
        freeSlack: result?.freeFloat,
        milestone: activity.milestone || activity.duration === 0,
        links: [],
      });
    }
  }

  const unresolvedDependenciesByActivity = new Map<string, string[]>();
  for (const activity of input.activities) {
    const targetUid = uidOfActivity.get(activity.id);
    const target = rows.find((row) => row.uid === targetUid);
    if (!target) continue;
    for (const dependency of activity.predecessors) {
      const predecessor = activityById.get(dependency.predecessorId) ?? activityByCode.get(dependency.predecessorId);
      const predecessorUid = predecessor ? uidOfActivity.get(predecessor.id) : undefined;
      if (!predecessorUid) {
        const unresolved = unresolvedDependenciesByActivity.get(activity.id) ?? [];
        unresolved.push(`${dependency.predecessorId} (${dependency.type}, lag ${dependency.lag})`);
        unresolvedDependenciesByActivity.set(activity.id, unresolved);
        continue;
      }
      // MSPDI LinkLag is stored in tenths of a minute; LinkLagFormat 7 denotes
      // working days. Keep the source lag in working-day units on import.
      target.links.push({
        uid: predecessorUid,
        type: LINK_TYPE[dependency.type] ?? 1,
        lag: Math.round(dependency.lag * hours * 60 * 10),
      });
    }
  }

  const taskXml = rows
    .map((row) => {
      const result = row.result;
      const raw = row.input;
      const start = dateTime(row.start, window.start);
      const finish = dateTime(row.finish, window.finish);
      const constraintType = CONSTRAINT_TYPE[raw?.constraintType ?? "ASAP"] ?? 0;
      const constraintDate = dateTime(raw?.constraintDate, window.start);
      const notes = raw ? taskNotes(raw, unresolvedDependenciesByActivity.get(raw.id) ?? []) : "";
      const resourceAssignments = raw?.resources ?? [];
      const totalWorkUnits = resourceAssignments.reduce((sum, assignment) => {
        const type = resourceById.get(assignment.resourceId)?.type;
        return type === "labor" || type === "equipment" ? sum + assignment.units : sum;
      }, 0);
      const work = result && totalWorkUnits > 0 ? isoDuration(result.duration * hours * totalWorkUnits) : undefined;
      const fixedCost = raw ? raw.fixedCost + raw.materialCost : undefined;

      return `      <Task>
        <UID>${row.uid}</UID>
        <ID>${row.id}</ID>
        <Name>${escapeXml(row.name)}</Name>
        <Type>1</Type>
        <IsNull>0</IsNull>
        <CreateDate>${analysis.generatedAt}</CreateDate>
        <WBS>${escapeXml(row.wbs)}</WBS>
        <OutlineNumber>${escapeXml(row.outlineNumber)}</OutlineNumber>
        <OutlineLevel>${row.outline}</OutlineLevel>
        <Summary>${row.summary ? 1 : 0}</Summary>
        ${start ? `<Start>${start}</Start>` : ""}
        ${finish ? `<Finish>${finish}</Finish>` : ""}
        <Duration>${isoDuration(row.durationDays * hours)}</Duration>
        <DurationFormat>7</DurationFormat>
        <PercentComplete>${Math.round(Math.max(0, Math.min(100, row.progress)))}</PercentComplete>
        <Milestone>${row.milestone ? 1 : 0}</Milestone>
        ${row.critical === undefined ? "" : `<Critical>${row.critical ? 1 : 0}</Critical>`}
        ${row.totalSlack === undefined ? "" : `<TotalSlack>${Math.round(row.totalSlack * hours * 60)}</TotalSlack>`}
        ${row.freeSlack === undefined ? "" : `<FreeSlack>${Math.round(row.freeSlack * hours * 60)}</FreeSlack>`}
        ${result ? `<Cost>${numberXml(result.budgetCost)}</Cost><ActualCost>${numberXml(result.actualCost)}</ActualCost>` : ""}
        ${fixedCost === undefined ? "" : `<FixedCost>${numberXml(fixedCost)}</FixedCost>`}
        ${work ? `<Work>${work}</Work>` : ""}
        <ConstraintType>${constraintType}</ConstraintType>
        ${constraintDate ? `<ConstraintDate>${constraintDate}</ConstraintDate>` : ""}
        <Text1>${escapeXml(raw?.deliverable ?? "")}</Text1>
        ${notes ? `<Notes>${escapeXml(notes)}</Notes>` : ""}
        <Active>1</Active>
        <Manual>0</Manual>
${row.links
  .map(
    (link) => `        <PredecessorLink>
          <PredecessorUID>${link.uid}</PredecessorUID>
          <Type>${link.type}</Type>
          <LinkLag>${link.lag}</LinkLag>
          <LinkLagFormat>7</LinkLagFormat>
        </PredecessorLink>`,
  )
  .join("\n")}
      </Task>`;
    })
    .join("\n");

  const resourceUid = new Map<string, number>();
  const resourcesXml = input.resources
    .map((resource, index) => {
      const uid = index + 1;
      if (!resourceUid.has(resource.id)) resourceUid.set(resource.id, uid);
      const summary = analysis.resources.find((item) => item.id === resource.id);
      const standardRateFormat = resource.type === "material" ? 7 : 3;
      return `      <Resource>
        <UID>${uid}</UID>
        <ID>${uid}</ID>
        <Name>${escapeXml(resource.name)}</Name>
        <Type>${RESOURCE_TYPE[resource.type]}</Type>
        <IsNull>0</IsNull>
        <MaxUnits>${numberXml(resource.capacity)}</MaxUnits>
        <StandardRate>${numberXml(resource.rate)}</StandardRate>
        <StandardRateFormat>${standardRateFormat}</StandardRateFormat>
        <Cost>${numberXml(summary?.cost ?? 0)}</Cost>
        <AccrueAt>3</AccrueAt>
        ${resource.type === "material" && resource.unit ? `<MaterialLabel>${escapeXml(resource.unit)}</MaterialLabel>` : ""}
      </Resource>`;
    })
    .join("\n");

  let assignmentUid = 1;
  const assignmentsXml = input.activities
    .flatMap((activity) => {
      const taskUid = uidOfActivity.get(activity.id);
      if (!taskUid) return [];
      const result = activityResultById.get(activity.id);
      return activity.resources.flatMap((assignment) => {
        const assignedResource = resourceById.get(assignment.resourceId);
        const resourceUidValue = resourceUid.get(assignment.resourceId);
        if (!assignedResource || resourceUidValue === undefined) return [];
        const isWorkResource = assignedResource.type === "labor" || assignedResource.type === "equipment";
        const resourceCost = assignedResource.rate * assignment.units * activity.duration;
        return [`      <Assignment>
        <UID>${assignmentUid++}</UID>
        <TaskUID>${taskUid}</TaskUID>
        <ResourceUID>${resourceUidValue}</ResourceUID>
        <Units>${numberXml(assignment.units)}</Units>
        ${result && isWorkResource ? `<RegularWork>${isoDuration(result.duration * hours * assignment.units)}</RegularWork>` : ""}
        <Cost>${numberXml(resourceCost)}</Cost>
        <AccrueAt>3</AccrueAt>
      </Assignment>`];
      });
    })
    .join("\n");

  const workDaysXml = Array.from({ length: 7 }, (_, day) => {
    const working = input.calendar.workDays.includes(day);
    return `        <WeekDay>
          <DayType>${DAY_TYPE[day]}</DayType>
          <DayWorking>${working ? 1 : 0}</DayWorking>
          ${working ? `<WorkingTimes><WorkingTime><FromTime>${window.start}</FromTime><ToTime>${window.finish}</ToTime></WorkingTime></WorkingTimes>` : "<WorkingTimes/>"}
        </WeekDay>`;
  }).join("\n");
  const holidayExceptions = input.calendar.holidays
    .filter(isIsoDate)
    .map((holiday, index) => `        <Exception>
          <EnteredByOccurrences>0</EnteredByOccurrences>
          <TimePeriod><FromDate>${holiday}T00:00:00</FromDate><ToDate>${holiday}T23:59:59</ToDate></TimePeriod>
          <Occurrences>1</Occurrences>
          <Name>${escapeXml(`تعطیلی ${holiday}`)}</Name>
          <Type>0</Type>
          <DayWorking>0</DayWorking>
          <WorkingTimes/>
        </Exception>`)
    .join("\n");

  const currencySymbol = input.meta.currency === "IRR" ? "ریال" : input.meta.currency === "USD" ? "$" : "€";
  const start = dateTime(analysis.schedule.startDate, window.start) ?? `${input.meta.startDate}T${window.start}`;
  const finish = dateTime(analysis.schedule.finishDate, window.finish) ?? `${input.meta.startDate}T${window.finish}`;
  const status = dateTime(input.meta.statusDate, window.finish) ?? `${input.meta.startDate}T${window.finish}`;
  const holidaysXml = holidayExceptions ? `<Exceptions>\n${holidayExceptions}\n      </Exceptions>` : "<Exceptions/>";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <UID>0</UID>
  <Name>${escapeXml(input.meta.name)}</Name>
  <Title>${escapeXml(input.meta.name)}</Title>
  <Subject>${escapeXml(input.meta.description ?? "")}</Subject>
  <Company>${escapeXml(input.meta.contractor ?? "HERMIPLAN")}</Company>
  <Manager>${escapeXml(input.meta.manager ?? "")}</Manager>
  <Project>1</Project>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${start}</StartDate>
  <FinishDate>${finish}</FinishDate>
  <StatusDate>${status}</StatusDate>
  <DefaultStartTime>${window.start}</DefaultStartTime>
  <DefaultFinishTime>${window.finish}</DefaultFinishTime>
  <MinutesPerDay>${Math.round(hours * 60)}</MinutesPerDay>
  <MinutesPerWeek>${Math.round(hours * 60 * input.calendar.workDays.length)}</MinutesPerWeek>
  <CurrencySymbol>${escapeXml(currencySymbol)}</CurrencySymbol>
  <CurrencyCode>${input.meta.currency}</CurrencyCode>
  <CurrencyDigits>${input.meta.currency === "IRR" ? 0 : 2}</CurrencyDigits>
  <CalendarUID>1</CalendarUID>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>تقویم کاری HERMIPLAN</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <BaseCalendarUID>-1</BaseCalendarUID>
      <WeekDays>
${workDaysXml}
      </WeekDays>
      ${holidaysXml}
    </Calendar>
  </Calendars>
  <Tasks>
${taskXml}
  </Tasks>
  <Resources>
${resourcesXml}
  </Resources>
  <Assignments>
${assignmentsXml}
  </Assignments>
</Project>`;
}
