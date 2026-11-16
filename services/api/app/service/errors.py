class InspectionError(Exception):
    """A request the inspection services refuse, with the HTTP status to use."""

    def __init__(self, detail: str, status_code: int = 400) -> None:
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


def not_found(detail: str) -> InspectionError:
    return InspectionError(detail, 404)


def conflict(detail: str) -> InspectionError:
    return InspectionError(detail, 409)


def unavailable(detail: str) -> InspectionError:
    return InspectionError(detail, 503)
