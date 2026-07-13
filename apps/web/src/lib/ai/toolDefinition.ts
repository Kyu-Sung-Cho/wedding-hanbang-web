export interface AiToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}
