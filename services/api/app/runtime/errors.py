"""Map inspection service failures to HTTP responses (no logic of its own)."""

import logging
from collections.abc import Callable

from fastapi import HTTPException

from app.service.errors import InspectionError
from app.service.keys import InvalidKeyPart

logger = logging.getLogger(__name__)


def call[T](fn: Callable[..., T], *args, **kwargs) -> T:
    """Run a service call; InspectionError -> its status, bad key part -> 400,
    B2 failure (RuntimeError) -> 502."""
    try:
        return fn(*args, **kwargs)
    except InspectionError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None
    except InvalidKeyPart as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    except RuntimeError as e:
        logger.warning("Storage call failed: %s", e)
        raise HTTPException(status_code=502, detail="Storage request failed; see API logs") from None
