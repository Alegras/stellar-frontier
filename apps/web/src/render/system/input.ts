/**
 * Ввод полёта: клавиатура + мышь с pointer lock (docs/05_ux_ui_spec.md §5.2).
 * Все слушатели снимаются в dispose(); никаких глобальных сайд-эффектов.
 */

export interface InputHooks {
  onSupercruise(): void;
  onAssist(): void;
  onStop(): void;
  onHeatSink(): void;
  onJump(): void;
  onCycleNav(): void;
  onCycleTarget(): void;
  onDock(): void;
  onExit(): void;
  onPip(sector: "sys" | "eng" | "wep", delta: number): void;
  onLockChange(locked: boolean): void;
  /** Часть XIII: варп «Наследие» — R цикл цели, Enter подтвердить раскрутку, Backspace отмена. */
  onWarp(): void;
  onWarpConfirm(): void;
  onWarpCancel(): void;
}

export class InputController {
  throttleUp = false;
  throttleDown = false;
  boost = false;
  rollLeft = false;
  rollRight = false;
  firePrimary = false;
  fireSecondary = false;
  pointerLocked = false;

  private mouseDX = 0;
  private mouseDY = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: InputHooks;

  constructor(canvas: HTMLCanvasElement, hooks: InputHooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  consumeMouse(): { dx: number; dy: number } {
    const result = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return result;
  }

  requestLock(): void {
    if (this.pointerLocked) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          /* pointer lock может быть отклонён браузером — молча продолжаем */
        });
      }
    } catch {
      /* noop */
    }
  }

  clearTransient(): void {
    this.throttleUp = false;
    this.throttleDown = false;
    this.boost = false;
    this.rollLeft = false;
    this.rollRight = false;
    this.firePrimary = false;
    this.fireSecondary = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    if (document.pointerLockElement === this.canvas) {
      try {
        document.exitPointerLock();
      } catch {
        /* noop */
      }
    }
    this.pointerLocked = false;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const repeat = e.repeat;
    switch (e.code) {
      case "KeyW":
        this.throttleUp = true;
        break;
      case "KeyS":
        this.throttleDown = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.boost = true;
        break;
      case "KeyA":
        this.rollLeft = true;
        break;
      case "KeyD":
        this.rollRight = true;
        break;
      case "KeyX":
        if (!repeat) this.hooks.onStop();
        break;
      case "KeyC":
        if (!repeat) this.hooks.onSupercruise();
        break;
      case "KeyZ":
        if (!repeat) this.hooks.onAssist();
        break;
      case "KeyV":
        if (!repeat) this.hooks.onHeatSink();
        break;
      case "KeyJ":
        if (!repeat) this.hooks.onJump();
        break;
      case "KeyQ":
        if (!repeat) this.hooks.onCycleTarget();
        break;
      case "KeyG":
        if (!repeat) this.hooks.onDock();
        break;
      case "KeyR":
        if (!repeat) this.hooks.onWarp();
        break;
      case "Enter":
      case "NumpadEnter":
        if (!repeat) {
          this.hooks.onWarpConfirm();
          e.preventDefault();
        }
        break;
      case "Backspace":
        if (!repeat) {
          this.hooks.onWarpCancel();
          e.preventDefault();
        }
        break;
      case "KeyM":
        if (!repeat) this.hooks.onExit();
        e.preventDefault();
        break;
      case "Escape":
        if (!this.pointerLocked) this.hooks.onExit();
        break;
      case "Tab":
        e.preventDefault();
        if (!repeat) this.hooks.onCycleNav();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!repeat) {
          if (e.shiftKey) this.hooks.onPip("wep", 1);
          else this.hooks.onPip("sys", 1);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!repeat) {
          if (e.shiftKey) this.hooks.onPip("wep", -1);
          else this.hooks.onPip("sys", -1);
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (!repeat) this.hooks.onPip("eng", 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (!repeat) this.hooks.onPip("eng", -1);
        break;
      default:
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "KeyW":
        this.throttleUp = false;
        break;
      case "KeyS":
        this.throttleDown = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.boost = false;
        break;
      case "KeyA":
        this.rollLeft = false;
        break;
      case "KeyD":
        this.rollRight = false;
        break;
      default:
        break;
    }
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      if (!this.pointerLocked) {
        this.requestLock();
        return;
      }
      this.firePrimary = true;
      e.preventDefault();
    } else if (e.button === 2) {
      this.fireSecondary = true;
      e.preventDefault();
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.firePrimary = false;
    else if (e.button === 2) this.fireSecondary = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onBlur = (): void => {
    this.clearTransient();
  };

  private readonly onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    this.pointerLocked = locked;
    if (!locked) {
      this.firePrimary = false;
      this.fireSecondary = false;
    }
    this.hooks.onLockChange(locked);
  };
}
