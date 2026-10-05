import { useEffect, useMemo, useState } from "react";
import { Alert, Form, Input, InputNumber, Modal, Select } from "antd";
import type { FieldKey, RundownItem } from "../types";

export interface EditValues {
  title: string;
  duration: number;
  hardStart?: string;
  presenter: string;
  source: string;
}

export function EditItemModal({
  item, currentRev, saving, conflict, onSave, onClose
}: {
  item: RundownItem;
  currentRev: number;
  saving: boolean;
  conflict: string | null;
  onSave: (fields: { field: FieldKey; value: string | number | undefined }[]) => void;
  onClose: () => void;
}) {
  const [form] = Form.useForm<EditValues>();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    form.setFieldsValue({ title: item.title, duration: item.duration, hardStart: item.hardStart ?? "", presenter: item.presenter, source: item.source });
    setStale(false);
  }, [form, item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentRev !== item.rev) setStale(true);
  }, [currentRev, item.rev]);

  const sealed = item.status === "已播出";
  const original = useMemo<EditValues>(() => ({ title: item.title, duration: item.duration, hardStart: item.hardStart ?? "", presenter: item.presenter, source: item.source }), [item]);

  const submit = () => {
    const values = form.getFieldsValue();
    const norm = (v: unknown) => v === undefined || v === "" ? undefined : String(v);
    const fields: { field: FieldKey; value: string | number | undefined }[] = [];
    if (values.title !== original.title) fields.push({ field: "title", value: values.title });
    if (Number(values.duration) !== original.duration) fields.push({ field: "duration", value: Number(values.duration) });
    if (norm(values.hardStart) !== norm(original.hardStart)) fields.push({ field: "hardStart", value: norm(values.hardStart) });
    if (values.presenter !== original.presenter) fields.push({ field: "presenter", value: values.presenter });
    if (values.source !== original.source) fields.push({ field: "source", value: values.source });
    if (!fields.length) { onClose(); return; }
    onSave(fields);
  };

  return (
    <Modal
      title={`编辑条目 · ${item.title}`}
      open
      onCancel={onClose}
      onOk={submit}
      okText="保存改动"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnClose
    >
      {sealed && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="该条目已播出，实际时长已封存，不能再编辑" />}
      {stale && !conflict && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message={`你打开后此条目已被其他窗口保存过（版本 ${item.rev} → ${currentRev}）`}
          description="下面仍是你打开时的内容。直接保存若与最新版本冲突会被拦下；也可先关闭按最新版本重新编辑。" />
      )}
      {conflict && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="保存未生效" description={conflict} />}
      <Form form={form} layout="vertical" disabled={sealed}>
        <Form.Item name="title" label="标题" rules={[{ required: true, min: 2, message: "标题至少 2 个字" }]}><Input /></Form.Item>
        <div className="two-cols">
          <Form.Item name="duration" label="计划时长" rules={[{ required: true }]}><InputNumber min={1} max={120} addonAfter="分钟" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="hardStart" label="硬时间（整点新闻等）" tooltip="留空表示无硬时间"><Select allowClear placeholder="无" options={hardStartOptions()} /></Form.Item>
        </div>
        <Form.Item name="presenter" label="主播" rules={[{ required: true, message: "请填写主播" }]}><Input /></Form.Item>
        <Form.Item name="source" label="来源" rules={[{ required: true, message: "请填写来源" }]}><Input /></Form.Item>
      </Form>
      <small className="muted-hint">保存后逐字段留痕；撤回时每个字段可独立抵消。当前版本 rev {currentRev}</small>
    </Modal>
  );
}

function hardStartOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 8; h <= 12; h += 1) {
    out.push({ value: `${String(h).padStart(2, "0")}:00`, label: `${String(h).padStart(2, "0")}:00 整点` });
    out.push({ value: `${String(h).padStart(2, "0")}:30`, label: `${String(h).padStart(2, "0")}:30` });
  }
  return out;
}
