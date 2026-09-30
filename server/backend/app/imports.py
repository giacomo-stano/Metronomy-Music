from .models import ImportRequest, ImportRequestCreate


class ImportQueue:
    """Prototype storage. Replace with PostgreSQL before exposing outside a private network."""

    def __init__(self) -> None:
        self._requests: list[ImportRequest] = []

    def add(self, request: ImportRequestCreate) -> ImportRequest:
        created = ImportRequest(**request.model_dump())
        self._requests.insert(0, created)
        return created

    def all(self) -> list[ImportRequest]:
        return self._requests


import_queue = ImportQueue()
