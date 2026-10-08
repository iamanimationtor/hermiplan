import type { ProjectAnalysis, ProjectInput, ResourceInput } from "@/lib/engine/types";

/**
 * MS Project Data Interchange (MSPDI / Project XML) writer.
 * The produced file opens directly in Microsoft Project, Primavera P6 and
 * most scheduling tools, preserving calendar, outline, critical path,
 * float, dependencies, resources and assignments.
 */

const esc = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most C0 control characters — strip them so a hostile
    // project name can never produce an unparseable MSPDI file
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** MSPDI dependency type codes */
const LINK_TYPE: Record<string, number> = { FS: 1, FF: 0, SF: 2, SS: 3 };
/** MSPDI weekday codes: 1 = Sunday … 7 = Saturday */
const DAY_TYPE: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7 };

function dateTime(iso: string, hour = 8): string {
  return `${iso}T${String(hour).padStart(2, "0")}:00:00`;
}

function duration(days: number, hoursPerDay: number): string {
  const hours = Math.max(0, Math.round(days * hoursPerDay));
  return `PT${hours}H`;
}

export function buildMsProjectXml(input: ProjectInput, analysis: ProjectAnalysis): string {
  const hours = input.calendar.hoursPerDay || 8;
  const activityById = new Map(analysis.activities.map((a) => [a.id, a]));
  const phaseNames: string[] = [];
  analysis.activities.forEach((a) => {
    if (!phaseNames.includes(a.phase)) phaseNames.push(a.phase);
  });

  // task rows: phase summaries (uid 1..n) then activities
  const rows: {
    uid: number;
    id: number;
    name: string;
    outline: number;
    summary: boolean;
    wbs: string;
    start: string;
    finish: string;
    days: number;
    progress: number;
    critical: boolean;
    totalSlack: number;
    freeSlack: number;
    milestone: boolean;
    links: { uid: number; type: number; lag: number }[];
  }[] = [];

  const uidOfActivity = new Map<string, number>();
  let uid = 1;

  phaseNames.forEach((phase, phaseIndex) => {
    const phaseUid = uid++;
    const phaseInfo = analysis.schedule.phases.find((p) => p.name === phase);
    rows.push({
      uid: phaseUid,
      id: rows.length + 1,
      name: phase,
      outline: 1,
      summary: true,
      wbs: `${phaseIndex + 1}`,
      start: phaseInfo?.startDate ?? analysis.schedule.startDate,
      finish: phaseInfo?.finishDate ?? analysis.schedule.finishDate,
      days: phaseInfo?.duration ?? 0,
      progress: phaseInfo?.progress ?? 0,
      critical: phaseInfo?.critical ?? false,
      totalSlack: 0,
      freeSlack: 0,
      milestone: false,
      links: [],
    });

    analysis.activities
      .filter((a) => a.phase === phase)
      .forEach((activity) => {
        uidOfActivity.set(activity.id, uid);
        rows.push({
          uid: uid++,
          id: rows.length + 1,
          name: activity.name,
          outline: 2,
          summary: false,
          wbs: activity.wbs,
          start: activity.startDate,
          finish: activity.finishDate,
          days: activity.duration,
          progress: activity.progress,
          critical: activity.critical,
          totalSlack: activity.totalFloat,
          freeSlack: activity.freeFloat,
          milestone: activity.milestone,
          links: [],
        });
      });
  });

  // resolve predecessor links
  input.activities.forEach((activity) => {
    const target = uidOfActivity.get(activity.id);
    if (!target) return;
    const row = rows.find((r) => r.uid === target);
    if (!row) return;
    activity.predecessors.forEach((dep) => {
      const predUid = uidOfActivity.get(dep.predecessorId);
      if (!predUid) return;
      row.links.push({ uid: predUid, type: LINK_TYPE[dep.type] ?? 1, lag: dep.lag });
    });
  });

  const weekDays = [0, 1, 2, 3, 4, 5, 6]
    .map((day) => {
      const working = input.calendar.workDays.includes(day);
      return `        <WeekDay>
          <DayType>${DAY_TYPE[day]}</DayType>
          <DayWorking>${working ? 1 : 0}</DayWorking>
          ${
            working
              ? `<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>${String(8 + hours).padStart(2, "0")}:00:00</ToTime></WorkingTime></WorkingTimes>`
              : "<WorkingTimes/>"
          }
        </WeekDay>`;
    })
    .join("\n");

  const tasksXml = rows
    .map(
      (row) => `      <Task>
        <UID>${row.uid}</UID>
        <ID>${row.id}</ID>
        <Name>${esc(row.name)}</Name>
        <Type>1</Type>
        <IsNull>0</IsNull>
        <Summary>${row.summary ? 1 : 0}</Summary>
        <WBS>${esc(row.wbs)}</WBS>
        <OutlineLevel>${row.outline}</OutlineLevel>
        <Start>${dateTime(row.start, 8)}</Start>
        <Finish>${dateTime(row.finish, row.milestone ? 8 : 17)}</Finish>
        <Duration>${duration(row.days, hours)}</Duration>
        <DurationFormat>7</DurationFormat>
        <PercentComplete>${Math.round(row.progress)}</PercentComplete>
        <Milestone>${row.milestone ? 1 : 0}</Milestone>
        <Critical>${row.critical ? 1 : 0}</Critical>
        <TotalSlack>${Math.round(row.totalSlack * hours * 60)}</TotalSlack>
        <FreeSlack>${Math.round(row.freeSlack * hours * 60)}</FreeSlack>
        <Active>1</Active>
        <Manual>0</Manual>
${row.links
  .map(
    (link) => `        <PredecessorLink>
          <PredecessorUID>${link.uid}</PredecessorUID>
          <Type>${link.type}</Type>
          <LinkLag>${Math.round(link.lag * hours * 60)}</LinkLag>
          <LinkLagFormat>3</LinkLagFormat>
        </PredecessorLink>`,
  )
  .join("\n")}
      </Task>`,
    )
    .join("\n");

  const resources: ResourceInput[] = input.resources;
  const resourceUid = new Map<string, number>();
  const resourcesXml = resources
    .map((resource, index) => {
      const uid = index + 1;
      resourceUid.set(resource.id, uid);
      return `      <Resource>
        <UID>${uid}</UID>
        <ID>${uid}</ID>
        <Name>${esc(resource.name)}</Name>
        <Type>1</Type>
        <MaxUnits>${resource.capacity || 1}</MaxUnits>
        <StandardRate>${resource.rate}</StandardRate>
        <StandardRateFormat>7</StandardRateFormat>
        <Cost>${analysis.resources.find((r) => r.id === resource.id)?.cost ?? 0}</Cost>
        <AccrueAt>3</AccrueAt>
      </Resource>`;
    })
    .join("\n");

  let assignmentUid = 1;
  const assignmentsXml = input.activities
    .flatMap((activity) => {
      const taskUid = uidOfActivity.get(activity.id);
      if (!taskUid) return [];
      return activity.resources
        .map((assignment) => {
          const resourceUidValue = resourceUid.get(assignment.resourceId);
          if (!resourceUidValue) return null;
          const activityRow = activityById.get(activity.id);
          return `      <Assignment>
        <UID>${assignmentUid++}</UID>
        <TaskUID>${taskUid}</TaskUID>
        <ResourceUID>${resourceUidValue}</ResourceUID>
        <Units>${assignment.units}</Units>
        <RegularWork>${duration(activity.duration, hours)}</RegularWork>
        <Cost>${activityRow?.budgetCost ?? 0}</Cost>
      </Assignment>`;
        })
        .filter(Boolean) as string[];
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>1</SaveVersion>
  <UID>0</UID>
  <Name>${esc(input.meta.name)}</Name>
  <Title>${esc(input.meta.name)}</Title>
  <Company>${esc(input.meta.contractor ?? "HERMIPLAN")}</Company>
  <Manager>${esc(input.meta.manager ?? "")}</Manager>
  <Project>1</Project>
  <StartDate>${dateTime(analysis.schedule.startDate, 8)}</StartDate>
  <FinishDate>${dateTime(analysis.schedule.finishDate, 17)}</FinishDate>
  <StatusDate>${dateTime(input.meta.statusDate, 17)}</StatusDate>
  <CurrencySymbol>${input.meta.currency === "IRR" ? "ریال" : input.meta.currency === "USD" ? "$" : "€"}</CurrencySymbol>
  <CalendarUID>1</CalendarUID>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>تقویم کاری HERMIPLAN</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <WeekDays>
${weekDays}
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>
${tasksXml}
  </Tasks>
  <Resources>
${resourcesXml}
  </Resources>
  <Assignments>
${assignmentsXml}
  </Assignments>
</Project>`;
}
