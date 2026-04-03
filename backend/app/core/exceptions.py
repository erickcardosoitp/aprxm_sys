from fastapi import HTTPException, status


class NotFoundError(HTTPException):
    def __init__(self, resource: str = "Recurso") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=f"{resource} não encontrado.")


class ForbiddenError(HTTPException):
    def __init__(self, detail: str = "Acesso negado.") -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class ConflictError(HTTPException):
    def __init__(self, detail: str = "Conflito de dados.") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class UnprocessableError(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


class CashSessionError(UnprocessableError):
    pass


class DeliveryFeeError(UnprocessableError):
    pass
