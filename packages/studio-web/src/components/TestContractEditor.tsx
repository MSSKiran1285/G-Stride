import type {
  DataSensitivity,
  TestContract,
  TestContractInput,
  TestContractOutput,
  TestValueType,
} from '../types';

const VALUE_TYPES: TestValueType[] = ['string', 'number', 'boolean', 'date', 'object', 'collection'];
const SENSITIVITIES: DataSensitivity[] = ['public', 'business', 'personal', 'secret'];

function nextName(prefix: string, names: string[]): string {
  let index = 1;
  while (names.includes(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

interface Props {
  contract: TestContract;
  stepNames: string[];
  onChange: (contract: TestContract) => void;
}

export function TestContractEditor({ contract, stepNames, onChange }: Props) {
  function updateInput(index: number, next: TestContractInput) {
    const inputs = [...contract.inputs];
    inputs[index] = next;
    onChange({ ...contract, inputs });
  }

  function updateOutput(index: number, next: TestContractOutput) {
    const outputs = [...contract.outputs];
    outputs[index] = next;
    onChange({ ...contract, outputs });
  }

  function addInput() {
    onChange({
      ...contract,
      inputs: [...contract.inputs, {
        name: nextName('input', contract.inputs.map((item) => item.name)),
        type: 'string',
        required: true,
        sensitivity: 'business',
      }],
    });
  }

  function addOutput() {
    onChange({
      ...contract,
      outputs: [...contract.outputs, {
        name: nextName('output', contract.outputs.map((item) => item.name)),
        type: 'string',
        sensitivity: 'business',
      }],
    });
  }

  return (
    <section className="test-contract-editor stack" aria-labelledby="testContractHeading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Typed composition contract</p>
          <h3 id="testContractHeading">Inputs and outputs</h3>
          <p className="hint">Inputs enter the Test; outputs are values captured for later steps or Processes.</p>
        </div>
        <span className="badge running">Contract v{contract.version}</span>
      </div>

      <div className="contract-section stack">
        <div className="section-heading-row compact">
          <strong>Inputs ({contract.inputs.length})</strong>
          <button type="button" className="ghost" onClick={addInput}>+ Add input</button>
        </div>
        {contract.inputs.length === 0 ? <p className="hint">This Test currently declares no external inputs.</p> : (
          <div className="contract-grid" role="list" aria-label="Test contract inputs">
            {contract.inputs.map((input, index) => (
              <div className="contract-row" role="listitem" key={`${index}-${input.name}`}>
                <div>
                  <label htmlFor={`contract-input-name-${index}`}>Name</label>
                  <input id={`contract-input-name-${index}`} aria-label={`Input ${index + 1} name`} value={input.name} onChange={(event) => updateInput(index, { ...input, name: event.target.value })} />
                </div>
                <div>
                  <label htmlFor={`contract-input-type-${index}`}>Type</label>
                  <select id={`contract-input-type-${index}`} aria-label={`Input ${index + 1} type`} value={input.type} onChange={(event) => updateInput(index, { ...input, type: event.target.value as TestValueType })}>
                    {VALUE_TYPES.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`contract-input-sensitivity-${index}`}>Sensitivity</label>
                  <select id={`contract-input-sensitivity-${index}`} aria-label={`Input ${index + 1} sensitivity`} value={input.sensitivity ?? 'business'} onChange={(event) => updateInput(index, { ...input, sensitivity: event.target.value as DataSensitivity })}>
                    {SENSITIVITIES.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`contract-input-runtime-${index}`}>Runtime key</label>
                  <input id={`contract-input-runtime-${index}`} aria-label={`Input ${index + 1} runtime key`} value={input.runtimeKey ?? ''} placeholder={input.name} onChange={(event) => updateInput(index, { ...input, runtimeKey: event.target.value || undefined })} />
                </div>
                <label className="contract-required-toggle">
                  <input type="checkbox" aria-label={`Input ${index + 1} required`} checked={input.required} onChange={(event) => updateInput(index, { ...input, required: event.target.checked })} />
                  Required
                </label>
                <button type="button" className="ghost danger" aria-label={`Remove input ${index + 1}`} onClick={() => onChange({ ...contract, inputs: contract.inputs.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="contract-section stack">
        <div className="section-heading-row compact">
          <strong>Outputs ({contract.outputs.length})</strong>
          <button type="button" className="ghost" onClick={addOutput}>+ Add output</button>
        </div>
        {contract.outputs.length === 0 ? <p className="hint">This Test currently declares no reusable outputs.</p> : (
          <div className="contract-grid" role="list" aria-label="Test contract outputs">
            {contract.outputs.map((output, index) => (
              <div className="contract-row" role="listitem" key={`${index}-${output.name}`}>
                <div>
                  <label htmlFor={`contract-output-name-${index}`}>Name</label>
                  <input id={`contract-output-name-${index}`} aria-label={`Output ${index + 1} name`} value={output.name} onChange={(event) => updateOutput(index, { ...output, name: event.target.value })} />
                </div>
                <div>
                  <label htmlFor={`contract-output-type-${index}`}>Type</label>
                  <select id={`contract-output-type-${index}`} aria-label={`Output ${index + 1} type`} value={output.type} onChange={(event) => updateOutput(index, { ...output, type: event.target.value as TestValueType })}>
                    {VALUE_TYPES.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`contract-output-sensitivity-${index}`}>Sensitivity</label>
                  <select id={`contract-output-sensitivity-${index}`} aria-label={`Output ${index + 1} sensitivity`} value={output.sensitivity ?? 'business'} onChange={(event) => updateOutput(index, { ...output, sensitivity: event.target.value as DataSensitivity })}>
                    {SENSITIVITIES.map((value) => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`contract-output-runtime-${index}`}>Runtime key</label>
                  <input id={`contract-output-runtime-${index}`} aria-label={`Output ${index + 1} runtime key`} value={output.runtimeKey ?? ''} placeholder={output.name} onChange={(event) => updateOutput(index, { ...output, runtimeKey: event.target.value || undefined })} />
                </div>
                <div>
                  <label htmlFor={`contract-output-step-${index}`}>Produced by</label>
                  <select id={`contract-output-step-${index}`} aria-label={`Output ${index + 1} producing step`} value={output.producedByStep ?? ''} onChange={(event) => updateOutput(index, { ...output, producedByStep: event.target.value || undefined })}>
                    <option value="">— select step —</option>
                    {stepNames.map((name, stepIndex) => <option key={`${stepIndex}-${name}`} value={name}>{stepIndex + 1}. {name}</option>)}
                  </select>
                </div>
                <button type="button" className="ghost danger" aria-label={`Remove output ${index + 1}`} onClick={() => onChange({ ...contract, outputs: contract.outputs.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
