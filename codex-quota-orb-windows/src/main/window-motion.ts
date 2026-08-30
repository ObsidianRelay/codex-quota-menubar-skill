import type {WindowMotionPhase} from "../shared/types";

export type MotionCommand =
  | "publish-mode"
  | "set-expanded-bounds"
  | "set-collapsed-bounds";

export class WindowMotionCoordinator {
  private currentPhase: WindowMotionPhase = "collapsed";
  private preparation: "surface" | "expanded-bounds" | null = null;

  get phase(): WindowMotionPhase {
    return this.currentPhase;
  }

  get isAnimating(): boolean {
    return this.currentPhase === "opening-prep" ||
      this.currentPhase === "opening" ||
      this.currentPhase === "closing";
  }

  beginOpening(): MotionCommand[] {
    if (this.currentPhase !== "collapsed") return [];
    this.currentPhase = "opening-prep";
    this.preparation = "surface";
    return ["publish-mode"];
  }

  surfacePrepared(): MotionCommand[] {
    if (this.currentPhase !== "opening-prep" || this.preparation !== "surface") return [];
    this.preparation = "expanded-bounds";
    return ["set-expanded-bounds"];
  }

  expandedBoundsPrepared(): MotionCommand[] {
    if (this.currentPhase !== "opening-prep" || this.preparation !== "expanded-bounds") return [];
    this.preparation = null;
    this.currentPhase = "opening";
    return ["publish-mode"];
  }

  openingComplete(): MotionCommand[] {
    if (this.currentPhase !== "opening") return [];
    this.currentPhase = "expanded";
    return ["publish-mode"];
  }

  beginClosing(): MotionCommand[] {
    if (this.currentPhase !== "expanded") return [];
    this.currentPhase = "closing";
    return ["publish-mode"];
  }

  closingComplete(): MotionCommand[] {
    if (this.currentPhase !== "closing") return [];
    this.currentPhase = "collapsed";
    return ["set-collapsed-bounds", "publish-mode"];
  }

  reset(): MotionCommand[] {
    this.currentPhase = "collapsed";
    this.preparation = null;
    return ["set-collapsed-bounds", "publish-mode"];
  }
}
