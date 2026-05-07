from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/gpu")
async def gpu_stats():
    try:
        import torch
        if not torch.cuda.is_available():
            return {"name": None, "used_mb": 0, "total_mb": 0, "utilization_pct": None}
        device = torch.device("cuda:0")
        props = torch.cuda.get_device_properties(device)
        used_bytes = torch.cuda.memory_allocated(device)
        total_bytes = props.total_memory
        return {
            "name": props.name,
            "used_mb": int(used_bytes / 1024 / 1024),
            "total_mb": int(total_bytes / 1024 / 1024),
            "utilization_pct": None,
        }
    except Exception:
        return {"name": None, "used_mb": 0, "total_mb": 0, "utilization_pct": None}
