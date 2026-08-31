import type {WindowMotionPhase} from "../shared/types";

export type MotionCommand =
  | "publish-mode"
  | "set-expanded-bounds"
  | "set-collapsed-bounds";

export class WindowMotionCoordinator {
  private currentPhase: WindowMotionPhase = "collapsed";
  private preparation: "surface" | "expanded-bounds" | null = null;
  private closeAfterOpening = false;

  get phase(): WindowMotionPhase {
    return this.currentPhase;
  }

  get isAnimating(): boolean {
    return this.currentPhase === "opening-prep" ||
      this.currentPhase === "opening" ||
      this.currentPhase === "closing" ||
      this.currentPhase === "closing-ready";
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
    if (this.closeAfterOpening) {
      this.closeAfterOpening = false;
      this.currentPhase = "closing";
      return ["publish-mode"];
    }
    this.currentPhase = "expanded";
    return ["publish-mode"];
  }

  beginClosing(): MotionCommand[] {
    if (this.currentPhase === "opening-prep" || this.currentPhase === "opening") {
      this.closeAfterOpening = true;
      return [];
    }
    if (this.currentPhase !== "expanded") return [];
    this.currentPhase = "closing";
    return ["publish-mode"];
  }

  closingComplete(): MotionCommand[] {
    if (this.currentPhase !== "closing") return [];
    this.currentPhase = "closing-ready";
    return ["publish-mode"];
  }

  collapsedSurfacePrepared(): MotionCommand[] {
    if (this.currentPhase !== "closing-ready") return [];
    this.currentPhase = "collapsed";
    return ["set-collapsed-bounds", "publish-mode"];
  }

  reset(): MotionCommand[] {
    this.currentPhase = "collapsed";
    this.preparation = null;
    this.closeAfterOpening = false;
    return ["set-collapsed-bounds", "publish-mode"];
  }
}
