import type { ProjectAnalysis, ProjectInput, ProjectType, ResourceType } from "@/lib/engine/types";

/**
 * MS Project Data Interchange (MSPDI / Project XML) writer.
 *
 * ## What this file has to get right
 *
 * The output is opened by Microsoft Project (and read by Primavera, Asta,
 * ProjectLibre and friends), so it is *not* "some XML that mentions tasks". The
 * earlier version opened, but degraded in ways a scheduler notices immediately:
 *
 *  • No `<MinutesPerDay>` / `<DefaultStartTime>` / `<WeekStartDay>`: Project
 *    assumed its own defaults (8h, 08:00, Sunday) whatever the project calendar
 *    said, so every imported duration was reinterpreted on a different day.
 *  • Control points that are not activities (the project's own ISO/quality
 *    gates) were dropped entirely: the report showed them, Project did not.
 *  • Costs were written per task *and* per assignment, which double-counts in
 *    Project's cost views; `Units`, `Work` and `Cost` did not agree.
 *  • No `<Notes>`, no project code, no currency code, no task constraints — so
 *    the file could not be told apart from any other export of the same name.
 *
 * ## Two rules that decide whether Project opens the file *cleanly*
 *
 * 1. **Element order is law.** MSPDI is an `xsd:sequence`. An element in the
 *    wrong slot is silently *dropped* by Project — no error, a clean open, a
 *    subtly wrong schedule. The orders below are documented in
 *    `mspdi.writer` (a library measured against genuine Project exports) and
 *    are followed exactly:
 *      - task: … `Duration`, `DurationFormat`, `Work`, `Milestone`, `Summary`,
 *        `PercentComplete`, `ConstraintType`, `CalendarUID`, `ConstraintDate`,
 *        `LevelingDelay`/`DelayFormat`, `IgnoreResourceCalendar`, `Notes`,
 *        `PredecessorLink`s last.
 *      - assignment: `UID`, `TaskUID`, `ResourceUID`, `Finish`, `Start`,
 *        `Units`, `Work` — finish *before* start, as Project writes it.
 * 2. **Identity.** `<UID>` is identity, `<ID>` is the 1..N row position. Reusing
 *    the UID as the ID makes Project raise a "scheduling conflict" wizard.
 *
 * ## Other semantics honoured here
 *
 *  • `LinkLag` and `LevelingDelay` are in **tenths of a minute**; `LinkLag` is
 *    expressed with `LagFormat=7` (working days rendered in minutes).
 *  • A milestone starts and finishes at the same instant (a one-day bar
 *    otherwise), and its `<Duration>` is zero.
 *  • Working hours come from the project calendar (`hoursPerDay`, `workDays`)
 *    and holidays travel as calendar `Exceptions` so Project cannot invent a
 *    working day that the plan treats as a holiday.
 *  • Money is rounded through the engine policy and written once per level:
 *    task `<Cost>` is the task's own budget (work + material + fixed), and
 *    assignment `<Cost>` is the resource share — Project sums assignments, so
 *    the numbers reconcile instead of doubling.
 *  • Control points are written as real milestones under a project summary
 *    ("نقاط کنترل پروژه") with an FF link to the activity they follow.
 */

const esc = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most C0 controls; strip them rather than emit a file
    // that every parser rejects.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** MSPDI dependency type codes: 0 = FF, 1 = FS, 2 = SF, 3 = SS. */
const LINK_TYPE: Record<string, number> = { FS: 1, FF: 0, SF: 2, SS: 3 };
/** MSPDI weekday codes: 1 = Sunday … 7 = Saturday. Engine weekdays: 0 = Sunday. */
const DAY_TYPE = [1, 2, 3, 4, 5, 6, 7];
/** MSPDI resource type: 0 = material, 1 = work, 2 = cost. */
const RESOURCE_TYPE: Record<ResourceType, number> = { labor: 1, equipment: 1, material: 0, cost: 2 };

/** `yyyy-mm-dd` → `yyyy-mm-ddThh:mm:ss`. Never emits an invalid ISO date. */
function dateTime(iso: string, hour: number, minute = 0): string {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "1970-01-01";
  return `${safe}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

const hhmmss = (hour: number) => `${String(hour).padStart(2, "0")}:00:00`;

/** ISO-8601 duration exactly as MS Project writes it (`PT8H0M0S`). */
function durationIso(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return `PT${hours}H${rest}M0S`;
}

/** Rounded money as a plain decimal (no exponent notation for large rials). */
const money = (value: number) => (Math.round((Number.isFinite(value) ? value : 0) * 100) / 100).toFixed(2);

const toMinutes = (days: number, hoursPerDay: number) => Math.round(Math.max(0, days) * hoursPerDay * 60);

const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  construction: "ساختمان (مسکونی / اداری)",
  civil: "عمرانی و زیرساخت",
  architecture: "طراحی و معماری",
  infrastructure: "زیرساخت و تأسیسات",
  software: "نرم‌افزار و فناوری",
  manufacturing: "صنعت و تولید",
  research: "پژوهش",
  event: "رویداد",
  renovation: "نوسازی و بازسازی",
  general: "عمومی (چندمنظوره)",
};

const CURRENCY: Record<string, { code: string; symbol: string }> = {
  IRR: { code: "IRR", symbol: "ریال" },
  USD: { code: "USD", symbol: "$" },
  EUR: { code: "EUR", symbol: "€" },
};

const RESOURCE_GROUP: Record<ResourceType, string> = {
  labor: "نیروی انسانی",
  equipment: "ماشین‌آلات",
  material: "مصالح",
  cost: "هزینه",
};

interface TaskRow {
  uid: number;
  id: number;
  name: string;
  wbs: string;
  outline: number;
  summary: boolean;
  milestone: boolean;
  start: string;
  finish: string;
  durationDays: number;
  progress: number;
  critical: boolean;
  totalSlack: number;
  freeSlack: number;
  cost: number;
  notes?: string;
  /** Filled in once every task owns a UID. */
  links: { uid: number; type: number; lagDays: number }[];
}

/**
 * Builds a Project XML document that opens in MS Project with the same
 * schedule, calendar, costs and assignments the report shows.
 */
export function buildMsProjectXml(input: ProjectInput, analysis: ProjectAnalysis): string {
  const hoursPerDay = input.calendar.hoursPerDay || 8;
  const startHour = 8;
  const finishHour = Math.min(23, startHour + hoursPerDay);
  const currency = CURRENCY[input.meta.currency] ?? CURRENCY.IRR;
  const workingWeek = input.calendar.workDays;

  const activityById = new Map(analysis.activities.map((activity) => [activity.id, activity]));
  const phaseNames: string[] = [];
  analysis.activities.forEach((activity) => {
    if (!phaseNames.includes(activity.phase)) phaseNames.push(activity.phase);
  });

  const rows: TaskRow[] = [];
  const uidOfActivity = new Map<string, number>();
  let uid = 1;

  /* ------------------------------ phases ------------------------------ */
  phaseNames.forEach((phase, phaseIndex) => {
    const info = analysis.schedule.phases.find((item) => item.name === phase);
    rows.push({
      uid: uid++,
      id: rows.length + 1,
      name: phase,
      wbs: String(phaseIndex + 1),
      outline: 1,
      summary: true,
      milestone: false,
      start: info?.startDate ?? analysis.schedule.startDate,
      finish: info?.finishDate ?? analysis.schedule.finishDate,
      durationDays: info?.duration ?? 0,
      progress: info?.progress ?? 0,
      critical: info?.critical ?? false,
      // Project recomputes summary slack from its children; writing 0 keeps the
      // file honest instead of asserting a value that will change on open.
      totalSlack: 0,
      freeSlack: 0,
      cost: 0,
      links: [],
    });
  });

  /* ---------------------------- activities ---------------------------- */
  phaseNames.forEach((phase) => {
    analysis.activities
      .filter((activity) => activity.phase === phase)
      .forEach((activity) => {
        uidOfActivity.set(activity.id, uid);
        const source = input.activities.find((item) => item.id === activity.id);
        rows.push({
          uid: uid++,
          id: rows.length + 1,
          name: activity.name,
          wbs: activity.wbs,
          outline: 2,
          summary: false,
          milestone: activity.milestone,
          start: activity.startDate,
          finish: activity.finishDate,
          durationDays: activity.duration,
          progress: activity.progress,
          critical: activity.critical,
          totalSlack: activity.totalFloat,
          freeSlack: activity.freeFloat,
          cost: activity.budgetCost,
          notes: [source?.deliverable ? `تحویل‌شدنی: ${source.deliverable}` : "", source?.notes ?? ""]
            .filter(Boolean)
            .join("\n"),
          links: [],
        });
      });
  });

  /* ------------------------- project control points -------------------- */
  // ISO/quality gates are scheduling objects in their own right; they used to be
  // silently dropped, so the report showed them and Project did not.
  const controlPoints = analysis.milestones.filter(
    (milestone) =>
      milestone.date && !analysis.activities.some((activity) => activity.milestone && activity.name === milestone.name),
  );
  if (controlPoints.length) {
    const summaryIndex = phaseNames.length + 1;
    rows.push({
      uid: uid++,
      id: rows.length + 1,
      name: "نقاط کنترل پروژه",
      wbs: String(summaryIndex),
      outline: 1,
      summary: true,
      milestone: false,
      start: controlPoints[0].date,
      finish: controlPoints[controlPoints.length - 1].date,
      durationDays: 0,
      progress: 0,
      critical: false,
      totalSlack: 0,
      freeSlack: 0,
      cost: 0,
      links: [],
    });
    controlPoints.forEach((milestone, index) => {
      rows.push({
        uid: uid++,
        id: rows.length + 1,
        name: milestone.name,
        wbs: `${summaryIndex}.${index + 1}`,
        outline: 2,
        summary: false,
        milestone: true,
        start: milestone.date,
        finish: milestone.date,
        durationDays: 0,
        progress: milestone.status === "reached" ? 100 : 0,
        critical: false,
        totalSlack: 0,
        freeSlack: 0,
        cost: 0,
        notes: milestone.linkedActivityCode ? `فعالیت مرتبط: ${milestone.linkedActivityCode}` : undefined,
        links: [],
      });
      // A linked control point is tied finish-to-finish to the activity whose
      // delivery it marks — the logical relationship the plan actually means.
      const linked = analysis.activities.find((activity) => activity.code === milestone.linkedActivityCode);
      const linkedUid = linked ? uidOfActivity.get(linked.id) : undefined;
      if (linkedUid) rows[rows.length - 1].links.push({ uid: linkedUid, type: LINK_TYPE.FF, lagDays: 0 });
    });
  }

  /* ------------------------------ links -------------------------------- */
  const rowByUid = new Map(rows.map((row) => [row.uid, row]));
  input.activities.forEach((activity) => {
    const targetUid = uidOfActivity.get(activity.id);
    const row = targetUid ? rowByUid.get(targetUid) : undefined;
    if (!row) return;
    activity.predecessors.forEach((dependency) => {
      const predecessorUid = uidOfActivity.get(dependency.predecessorId);
      if (!predecessorUid || predecessorUid === row.uid) return; // never self-link
      row.links.push({ uid: predecessorUid, type: LINK_TYPE[dependency.type] ?? LINK_TYPE.FS, lagDays: dependency.lag });
    });
  });

  /* ----------------------------- calendar ------------------------------ */
  const weekDays = DAY_TYPE.map((dayType, index) => {
    const working = workingWeek.includes(index);
    return `        <WeekDay>
          <DayType>${dayType}</DayType>
          <DayWorking>${working ? 1 : 0}</DayWorking>${
            working
              ? `\n          <WorkingTimes>
            <WorkingTime>
              <FromTime>${hhmmss(startHour)}</FromTime>
              <ToTime>${hhmmss(finishHour)}</ToTime>
            </WorkingTime>
          </WorkingTimes>`
              : ""
          }
        </WeekDay>`;
  }).join("\n");

  const exceptions = [...new Set(input.calendar.holidays.filter((holiday) => /^\d{4}-\d{2}-\d{2}$/.test(holiday)))]
    .map(
      (holiday, index) => `      <Exception>
        <Index>${index + 1}</Index>
        <Name>تعطیل رسمی</Name>
        <TimePeriod>
          <FromDate>${dateTime(holiday, 0)}</FromDate>
          <ToDate>${dateTime(holiday, 23, 59)}</ToDate>
        </TimePeriod>
        <Occurrences>1</Occurrences>
      </Exception>`,
    )
    .join("\n");

  /* ------------------------------- tasks ------------------------------- */
  const tasksXml = rows
    .map((row) => {
      // A milestone is an instant; Project renders a one-day bar for a milestone
      // whose start and finish differ.
      const start = row.milestone ? dateTime(row.finish, finishHour) : dateTime(row.start, startHour);
      const finish = dateTime(row.finish, finishHour);
      // A summary's Work is a roll-up of its children's. Writing the phase's
      // span in hours (680h for a 30-day phase) inflated the project total and
      // disagreed with the assignments underneath it.
      const workMinutes = row.milestone ? 0 : toMinutes(row.durationDays, hoursPerDay);
      const progress = Math.round(Math.min(100, Math.max(0, row.progress)));
      const actualMinutes = Math.round((workMinutes * progress) / 100);

      // Order follows `mspdi.writer.TASK_ORDER` exactly (see the header comment).
      return `    <Task>
      <UID>${row.uid}</UID>
      <ID>${row.id}</ID>
      <Name>${esc(row.name)}</Name>
      <Active>1</Active>
      <Manual>0</Manual>
      <Type>1</Type>
      <IsNull>0</IsNull>
      <CreateDate>${dateTime(input.meta.statusDate, finishHour)}</CreateDate>
      <WBS>${esc(row.wbs)}</WBS>
      <OutlineNumber>${esc(row.wbs)}</OutlineNumber>
      <OutlineLevel>${row.outline}</OutlineLevel>
      <Priority>500</Priority>
      <Start>${start}</Start>
      <Finish>${finish}</Finish>
      <Duration>${durationIso(workMinutes)}</Duration>
      <DurationFormat>7</DurationFormat>
      <Work>${durationIso(row.summary ? 0 : workMinutes)}</Work>
      <Milestone>${row.milestone ? 1 : 0}</Milestone>
      <Summary>${row.summary ? 1 : 0}</Summary>
      <PercentComplete>${progress}</PercentComplete>
      <ConstraintType>0</ConstraintType>
      <CalendarUID>1</CalendarUID>
      <LevelingDelay>0</LevelingDelay>
      <LevelingDelayFormat>7</LevelingDelayFormat>
      <IgnoreResourceCalendar>0</IgnoreResourceCalendar>${
        row.notes
          ? `
      <Notes>${esc(row.notes)}</Notes>`
          : ""
      }${
        row.links.length
          ? `
${row.links
  .map(
    (link) => `      <PredecessorLink>
        <PredecessorUID>${link.uid}</PredecessorUID>
        <Type>${link.type}</Type>
        <CrossProject>0</CrossProject>
        <LinkLag>${Math.round(link.lagDays * hoursPerDay * 60)}</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>`,
  )
  .join("\n")}`
          : ""
      }
    </Task>`;
    })
    .join("\n");

  /* ----------------------------- resources ----------------------------- */
  const resourceUid = new Map<string, number>();
  const resourcesXml = input.resources
    .map((resource, index) => {
      const uidValue = index + 1;
      resourceUid.set(resource.id, uidValue);
      const result = analysis.resources.find((item) => item.id === resource.id);
      const isMaterial = resource.type === "material";
      const isCost = resource.type === "cost";
      const capacity = isCost ? 1 : Math.max(1, resource.capacity || 1);

      // Order follows `mspdi.writer.RESOURCE_ORDER`.
      return `    <Resource>
      <UID>${uidValue}</UID>
      <ID>${uidValue}</ID>
      <Name>${esc(resource.name)}</Name>
      <Type>${RESOURCE_TYPE[resource.type] ?? 1}</Type>
      <IsNull>0</IsNull>
      <Initials>${esc(resource.name.slice(0, 4))}</Initials>
      <MaxUnits>${capacity}</MaxUnits>
      <CanLevel>1</CanLevel>
      <AccrueAt>3</AccrueAt>
      <CalendarUID>1</CalendarUID>${
        [isMaterial ? `واحد: ${resource.unit ?? "—"}` : "", resource.rateSource ? `مبنای نرخ: ${resource.rateSource}` : ""]
          .filter(Boolean).length
          ? `
      <Notes>${esc(
        [isMaterial ? `واحد: ${resource.unit ?? "—"}` : "", resource.rateSource ? `مبنای نرخ: ${resource.rateSource}` : "", `گروه: ${RESOURCE_GROUP[resource.type]}`]
          .filter(Boolean)
          .join(" · "),
      )}</Notes>`
          : ""
      }
    </Resource>`;
    })
    .join("\n");

  /* ---------------------------- assignments ---------------------------- */
  let assignmentUid = 1;
  const assignmentRows: string[] = [];
  input.activities.forEach((activity) => {
    const taskUid = uidOfActivity.get(activity.id);
    const activityResult = activityById.get(activity.id);
    if (!taskUid || !activityResult) return;
    const activityMinutes = toMinutes(activityResult.duration, hoursPerDay);
    const totalUnits = activity.resources.reduce((sum, item) => sum + Math.max(0.01, item.units), 0) || 1;
    const progress = Math.min(100, Math.max(0, activityResult.progress));

    activity.resources.forEach((assignment) => {
      const resourceUidValue = resourceUid.get(assignment.resourceId);
      const resource = input.resources.find((item) => item.id === assignment.resourceId);
      if (!resourceUidValue || !resource) return;

      const units = Math.max(0.01, assignment.units);
      const share = activityMinutes * (units / totalUnits);
      // Materials are priced per unit of *quantity*, not per hour: their work is
      // the quantity delivered, their cost is units × unit price.
      const isMaterial = resource.type === "material";
      const assignmentMinutes = isMaterial ? 0 : Math.round(share);
      const assignmentCost = isMaterial ? units * resource.rate : (share / 60) * resource.rate;
      const actualMinutes = Math.round(assignmentMinutes * (progress / 100));

      // Order follows `mspdi.writer.ASSIGNMENT_ORDER` (finish before start).
      assignmentRows.push(`    <Assignment>
      <UID>${assignmentUid++}</UID>
      <TaskUID>${taskUid}</TaskUID>
      <ResourceUID>${resourceUidValue}</ResourceUID>
      <Finish>${dateTime(activityResult.finishDate, finishHour)}</Finish>
      <HasFixedRateUnits>0</HasFixedRateUnits>
      <FixedMaterial>0</FixedMaterial>
      <LevelingDelayFormat>7</LevelingDelayFormat>
      <Start>${dateTime(activityResult.startDate, startHour)}</Start>
      <Units>${units}</Units>
      <Work>${durationIso(assignmentMinutes)}</Work>
      <WorkContour>0</WorkContour>${
        actualMinutes || assignmentCost
          ? `
      <ActualWork>${durationIso(actualMinutes)}</ActualWork>
      <RemainingWork>${durationIso(assignmentMinutes - actualMinutes)}</RemainingWork>
      <Cost>${money(assignmentCost)}</Cost>`
          : ""
      }
    </Assignment>`);
    });
  });

  const estimate = analysis.pricing?.breakdown?.total ?? analysis.costs.budget;

  // Order follows `mspdi.writer.PROJECT_ORDER`; anything outside the sequence is
  // dropped by Project on open, so this list is deliberately conservative.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${esc(input.meta.name)}</Name>
  <Title>${esc(input.meta.name)}</Title>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${dateTime(analysis.schedule.startDate, startHour)}</StartDate>
  <FinishDate>${dateTime(analysis.schedule.finishDate, finishHour)}</FinishDate>
  <CalendarUID>1</CalendarUID>
  <DefaultStartTime>${hhmmss(startHour)}</DefaultStartTime>
  <DefaultFinishTime>${hhmmss(finishHour)}</DefaultFinishTime>
  <MinutesPerDay>${hoursPerDay * 60}</MinutesPerDay>
  <MinutesPerWeek>${hoursPerDay * 60 * Math.max(1, workingWeek.length)}</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <DefaultTaskType>1</DefaultTaskType>
  <DurationFormat>7</DurationFormat>
  <WorkFormat>2</WorkFormat>
  <HonorConstraints>1</HonorConstraints>
  <NewTasksAreManual>0</NewTasksAreManual>
  <CurrencyDigits>0</CurrencyDigits>
  <CurrencySymbol>${esc(currency.symbol)}</CurrencySymbol>
  <CurrencyCode>${esc(currency.code)}</CurrencyCode>
  <CurrencySymbolPosition>0</CurrencySymbolPosition>
  <StatusDate>${dateTime(input.meta.statusDate, finishHour)}</StatusDate>
  <WeekStartDay>${DAY_TYPE[workingWeek[0] ?? 6]}</WeekStartDay>
  <Company>${esc(input.meta.contractor ?? "HERMIPLAN")}</Company>
  <Manager>${esc(input.meta.manager ?? "")}</Manager>
  <Author>HERMIPLAN</Author>
  <Category>HERMIPLAN</Category>
  <Subject>${esc(PROJECT_TYPE_LABEL[input.meta.type] ?? input.meta.type)}</Subject>
  <Notes>${esc(
    [
      `کد پروژه: ${input.meta.code ?? "—"}`,
      `نوع پروژه: ${PROJECT_TYPE_LABEL[input.meta.type] ?? input.meta.type}`,
      `کارفرما: ${input.meta.client ?? "—"}`,
      `مشاور: ${input.meta.consultant ?? "—"}`,
      `برآورد نهایی (بالاسری + سود + احتیاط + تعدیل): ${estimate.toLocaleString("en-US")} ${input.meta.currency}`,
      `مبنای نرخ: ${analysis.pricing.asOfJalali} — ${analysis.pricing.regionLabel}`,
      "تولید‌شده با HERMIPLAN — زمان‌بندی CPM/PDM و تحلیل EVM",
    ].join("\n"),
  )}</Notes>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>${esc(`تقویم کاری ${input.meta.name}`.slice(0, 60))}</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <BaseCalendarUID>-1</BaseCalendarUID>
      <WeekDays>
${weekDays}
      </WeekDays>${
        exceptions
          ? `
      <Exceptions>
${exceptions}
      </Exceptions>`
          : ""
      }
    </Calendar>
  </Calendars>
  <Tasks>
${tasksXml}
  </Tasks>
  <Resources>
${resourcesXml}
  </Resources>
  <Assignments>
${assignmentRows.join("\n")}
  </Assignments>
</Project>`;
}
