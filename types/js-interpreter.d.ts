declare module "js-interpreter" {
  class Interpreter {
    constructor(code: string, initFunc?: (interpreter: Interpreter, globalObject: object) => void);
    run(): void;
    step(): boolean;
    getScope(): object;
    setProperty(obj: object, name: string, value: unknown): void;
    createPrimitive(value: unknown): unknown;
    createNativeFunction(func: (...args: unknown[]) => unknown): unknown;
    createObject(properties?: Record<string, unknown>): object;
  }
  export default Interpreter;
}
