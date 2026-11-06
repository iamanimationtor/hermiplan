/**
 * Share-state presentation logic (pure).
 *
 * Why this is not inline in the component
 * ---------------------------------------
 * Since migration `0003`, a report is reachable through a token, not through its
 * UUID. Projects published *before* that migration still carry `isPublic = true`
 * but have no token, so their old link silently stops working. The owner must be
 * told, in the product, what happened and what to do — and that rule needs a test
 * without a browser.
 *
 * Keeping it here also prevents the two places that describe the state (the
 * header badge and the share panel) from drifting apart.
 */
export interface ShareLinkLike {
  active: boolean;
}

export type ShareStateKind = "private" | "shared" | "legacy-inactive";

export interface ShareState {
  kind: ShareStateKind;
  activeCount: number;
  /** Short label for the header badge. */
  badge: string;
  /** Tooltip / one-line explanation. */
  hint: string;
  /**
   * A sentence the owner must see, or `null`. Only present for the legacy state,
   * where the interface would otherwise look like "everything is fine".
   */
  notice: string | null;
}

export function describeShareState(isPublic: boolean, links: readonly ShareLinkLike[]): ShareState {
  const activeCount = links.filter((link) => link.active).length;

  if (activeCount > 0) {
    return {
      kind: "shared",
      activeCount,
      badge: "🔗 لینک اشتراک فعال",
      hint: "این گزارش با لینک اشتراک قابل مشاهده است؛ هر لینک جداگانه قابل ابطال است",
      notice: null,
    };
  }

  if (isPublic) {
    // Published before tokens existed. Nothing grants access any more.
    return {
      kind: "legacy-inactive",
      activeCount: 0,
      badge: "⚠️ لینک قدیمی غیرفعال",
      hint: "این پروژه پیش از تغییر روش اشتراک، عمومی بود؛ لینک قدیمی کار نمی‌کند",
      notice:
        "این گزارش پیش‌تر با لینک قدیمی (بر پایه شناسه پروژه) به اشتراک گذاشته شده بود. " +
        "برای امنیت، آن لینک دیگر کار نمی‌کند و فقط مالک می‌تواند گزارش را ببیند. " +
        "اگر هنوز به اشتراک نیاز دارید، یک لینک تازه بسازید.",
    };
  }

  return {
    kind: "private",
    activeCount: 0,
    badge: "🔒 خصوصی",
    hint: "فقط شما می‌توانید این گزارش را ببینید",
    notice: null,
  };
}
