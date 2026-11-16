# Handlers are sync `def` on purpose: every call is blocking boto3 (and, for
# scoring, PyTorch), so Starlette runs them in its threadpool.
from fastapi import APIRouter

from app.runtime.errors import call
from app.service import lines, model_versions
from app.types.lines import CreateLineRequest, Line, LineDetail, UpdateLineRequest

router = APIRouter()


@router.get("/lines", response_model=list[Line])
def list_lines():
    """Every inspection line, by id."""
    return call(lines.list_lines)


@router.post("/lines", response_model=Line)
def create_line(req: CreateLineRequest):
    """Create a line. 409 if the id is taken."""
    return call(lines.create_line, req)


@router.get("/lines/{line_id}", response_model=LineDetail)
def get_line(line_id: str):
    """A line with part counts by status, model count and score summary."""
    return call(model_versions.line_detail, line_id)


@router.patch("/lines/{line_id}", response_model=Line)
def update_line(line_id: str, req: UpdateLineRequest):
    """Edit name or description. The active model changes only via /activate."""
    return call(lines.update_line, line_id, req)
