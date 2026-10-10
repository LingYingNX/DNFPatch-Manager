import { useEffect, useState } from "react";
import type { DnfApi } from "../../shared/ipc-contracts";
import type { RecoveryStateDto } from "../../shared/recovery-contracts";

const HEALTHY: RecoveryStateDto = { readOnly: false, files: [] };

export function useRecoveryState(client: DnfApi | undefined): RecoveryStateDto {
  const [state, setState] = useState(HEALTHY);
  useEffect(() => {
    if (client === undefined) return;
    // 卸载或切换 client 后丢弃在途结果，避免旧结果覆盖新 client 的状态。
    let active = true;
    void client.getRecoveryState().then((result) => {
      if (!active || !result.ok) return;
      setState(result.value);
    });
    return () => {
      active = false;
    };
  }, [client]);
  return state;
}
