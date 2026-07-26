import { afterEach, describe, expect, test } from "bun:test";
import type { Companion, ReactionState } from "../../core/model.ts";
import { BuddyWidget, displayWidth, renderCompanionWidget, stripAnsi, subscribeToWidgetResize } from "./widget-layout.ts";

const companion: Companion = {
  name: "Nimbus",
  personality: "quietly observant",
  userId: "test-user",
  hatchedAt: 0,
  bones: {
    rarity: "uncommon",
    species: "blob",
    eye: "°",
    hat: "none",
    shiny: false,
    peak: "WISDOM",
    dump: "CHAOS",
    stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 40, WISDOM: 90, SNARK: 40 },
  },
};

const reaction: ReactionState = {
  reaction: "*blinks slowly* slicing backwards, the ancient way",
  reason: "turn",
  timestamp: 0,
};

describe("shared buddy widget layout", () => {
  test.each([40, 60, 80, 120])("keeps the hero composition safe at %i columns", (width) => {
    const lines = renderCompanionWidget(companion, reaction, [], width, 0);
    const plain = lines.map(stripAnsi);
    const tailLine = plain.find((line) => line.includes("--   "));
    const artLine = plain.find((line) => line.includes("( °  ° )"));

    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.every((line) => displayWidth(line) <= width)).toBe(true);
    expect(tailLine).toBeDefined();
    expect(tailLine!.indexOf("--   ")).toBeLessThan(tailLine!.indexOf("( °  ° )"));
    expect(plain.at(-1)).toContain("Nimbus");
    expect(artLine).toBeDefined();
  });

  test("drops the frame and tail together when the sprite cannot fit", () => {
    const lines = renderCompanionWidget(companion, reaction, [], 24, 0);
    const plain = lines.map(stripAnsi).join("\n");

    expect(plain).not.toMatch(/\|.*\|--   /);
    expect(plain).not.toMatch(/^ *\.[-]{12,}\.$/m);
    expect(lines.every((line) => displayWidth(line) <= 24)).toBe(true);
  });

  test("applies rarity color to the bubble card, sprite, and centered name", () => {
    const lines = renderCompanionWidget(companion, reaction, [], 80, 0);
    const colored = lines.filter((line) => line.includes("\x1b[38;2;78;186;101m"));

    expect(colored.some((line) => stripAnsi(line).includes("( °  ° )"))).toBe(true);
    expect(colored.some((line) => stripAnsi(line).includes("Nimbus ★★"))).toBe(true);
  });

  test("notifies resize subscribers and removes them cleanly", () => {
    let calls = 0;
    const unsubscribe = subscribeToWidgetResize(() => {
      calls += 1;
    });

    process.stdout.emit("resize");
    expect(calls).toBe(1);
    unsubscribe();
    process.stdout.emit("resize");
    expect(calls).toBe(1);
  });
});

describe("east-asian width parity with the shell renderer", () => {
  test("counts CJK and fullwidth as two columns, box drawing as one", () => {
    expect(displayWidth("你好")).toBe(4);
    expect(displayWidth("这个错误处理程序")).toBe(16);
    expect(displayWidth("Ａ")).toBe(2);
    expect(displayWidth("│")).toBe(1);
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("🏆")).toBe(2);
  });

  test("frames a CJK reaction without shearing the box", () => {
    const width = 60;
    const lines = renderCompanionWidget(
      { name: "Nimbus", bones: { species: "duck", rarity: "uncommon", eye: "°", hat: "none", shiny: false, stats: {}, peak: "CHAOS", dump: "PATIENCE" } } as never,
      { reaction: "这个错误处理程序缺少一个最终块", timestamp: Date.now() } as never,
      [],
      width,
    );
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});

function createFakeScheduler() {
  let nextId = 1;
  const timers: Array<{ id: number; fn: () => void; ms?: number }> = [];

  class FakeTimer implements Timer {
    constructor(private readonly id: number) {}
    ref(): Timer {
      return this;
    }
    unref(): Timer {
      return this;
    }
    hasRef(): boolean {
      return true;
    }
    refresh(): Timer {
      return this;
    }
    [Symbol.toPrimitive](): number {
      return this.id;
    }
  }


  return {
    setTimeout: (fn: () => void, ms?: number): Timer => {
      const id = nextId++;
      timers.push({ id, fn, ms });
      return new FakeTimer(id);
    },
    clearTimer: (timer: Timer): void => {
      const id = Number(timer);
      const index = timers.findIndex((t) => t.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    runAll: (): void => {
      while (timers.length) {
        const t = timers.shift()!;
        t.fn();
      }
    },
    pendingCount: (): number => timers.length,
  };
}

function hasBubble(lines: string[]): boolean {
  const plain = lines.map(stripAnsi).join("\n");
  return /^ *\.[-]{12,}\.\s*$/m.test(plain) && /\|--\s+\S/.test(plain);
}

describe("BuddyWidget resize behavior", () => {
  const activeWidgets: BuddyWidget[] = [];

  afterEach(() => {
    for (const widget of activeWidgets) widget.dispose();
    activeWidgets.length = 0;
  });

  function makeWidget(widthRef: { width: number }) {
    const scheduler = createFakeScheduler();
    const captures: string[][] = [];
    const widget = new BuddyWidget({
      getWidth: () => widthRef.width,
      scheduler,
      coalesceMs: 10,
    });
    activeWidgets.push(widget);
    return { widget, scheduler, captures, setWidget: (lines: string[]) => captures.push(lines) };
  }

  test("coalesces a burst of resize events into one re-render", () => {
    const widthRef = { width: 80 };
    const { widget, scheduler, captures, setWidget } = makeWidget(widthRef);

    widget.refresh(setWidget, companion, reaction, []);
    expect(captures).toHaveLength(1);

    widthRef.width = 64;
    process.stdout.emit("resize");
    widthRef.width = 40;
    process.stdout.emit("resize");
    widthRef.width = 24;
    process.stdout.emit("resize");
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runAll();
    expect(captures).toHaveLength(2);
    expect(captures[1]!.every((line) => displayWidth(line) <= 24)).toBe(true);
  });

  test("re-renders with the new width after a resize settles", () => {
    const widthRef = { width: 80 };
    const { widget, scheduler, captures, setWidget } = makeWidget(widthRef);

    widget.refresh(setWidget, companion, reaction, []);
    const first = captures[0]!;
    expect(first.every((line) => displayWidth(line) <= 80)).toBe(true);

    widthRef.width = 24;
    process.stdout.emit("resize");
    scheduler.runAll();
    const last = captures.at(-1)!;
    expect(last).not.toEqual(first);
    expect(last.every((line) => displayWidth(line) <= 24)).toBe(true);
  });

  test("reads the width when the coalesced timer fires, not at the event time", () => {
    const widthRef = { width: 80 };
    const { widget, scheduler, captures, setWidget } = makeWidget(widthRef);

    widget.refresh(setWidget, companion, reaction, []);
    process.stdout.emit("resize");
    widthRef.width = 24;
    scheduler.runAll();
    const last = captures.at(-1)!;
    expect(last.every((line) => displayWidth(line) <= 24)).toBe(true);
  });

  test("drops the bubble at tiny widths and restores it when growing back", () => {
    const widthRef = { width: 80 };
    const { widget, scheduler, captures, setWidget } = makeWidget(widthRef);

    widget.refresh(setWidget, companion, reaction, []);
    expect(hasBubble(captures[0]!)).toBe(true);

    widthRef.width = 24;
    process.stdout.emit("resize");
    scheduler.runAll();
    expect(captures).toHaveLength(2);
    expect(hasBubble(captures[1]!)).toBe(false);

    widthRef.width = 80;
    process.stdout.emit("resize");
    scheduler.runAll();
    expect(captures).toHaveLength(3);
    expect(hasBubble(captures[2]!)).toBe(true);
  });
  test("cancels a pending resize before replacing its scheduler", () => {
    const widthRef = { width: 80 };
    const { widget, scheduler: firstScheduler, captures, setWidget } = makeWidget(widthRef);
    const secondScheduler = createFakeScheduler();

    widget.refresh(setWidget, companion, reaction, [], firstScheduler);
    process.stdout.emit("resize");
    expect(firstScheduler.pendingCount()).toBe(1);

    widget.refresh(setWidget, { ...companion, name: "Current" }, reaction, [], secondScheduler);
    expect(firstScheduler.pendingCount()).toBe(0);

    widthRef.width = 24;
    process.stdout.emit("resize");
    expect(secondScheduler.pendingCount()).toBe(1);
    secondScheduler.runAll();
    expect(captures.at(-1)!.every((line) => displayWidth(line) <= 24)).toBe(true);
  });

  test("does not schedule work after the widget is cleared", () => {
    const widthRef = { width: 80 };
    const { widget, scheduler, setWidget } = makeWidget(widthRef);

    widget.refresh(setWidget, companion, reaction, []);
    widget.clear();
    process.stdout.emit("resize");

    expect(scheduler.pendingCount()).toBe(0);
  });
});
