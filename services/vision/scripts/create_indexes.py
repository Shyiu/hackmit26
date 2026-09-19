from vision_service.config import Settings
from vision_service.db import ensure_indexes, get_client, get_db


def main() -> None:
    settings = Settings()
    names = ensure_indexes(get_db(get_client(settings), settings))
    for collection, indexes in names.items():
        print(collection, *indexes, sep=": ")


if __name__ == "__main__":
    main()
