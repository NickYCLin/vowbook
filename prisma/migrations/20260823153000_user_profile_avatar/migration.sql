CREATE TABLE "user_avatars" (
    "user_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "media_type" VARCHAR(40) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_avatars_media_type_check" CHECK ("media_type" = 'image/webp'),
    CONSTRAINT "user_avatars_byte_size_check" CHECK ("byte_size" BETWEEN 1 AND 1048576),
    CONSTRAINT "user_avatars_data_length_check" CHECK (
        octet_length("data") = "byte_size"
    ),
    CONSTRAINT "user_avatars_sha256_check" CHECK (
        "sha256" ~ '^[0-9a-f]{64}$'
        AND "sha256" = encode(sha256("data"), 'hex')
    ),
    CONSTRAINT "user_avatars_webp_signature_check" CHECK (
        octet_length("data") >= 16
        AND substring("data" FROM 1 FOR 4) = convert_to('RIFF', 'UTF8')
        AND substring("data" FROM 9 FOR 4) = convert_to('WEBP', 'UTF8')
        AND substring("data" FROM 13 FOR 4) IN (
            convert_to('VP8 ', 'UTF8'),
            convert_to('VP8L', 'UTF8'),
            convert_to('VP8X', 'UTF8')
        )
        AND (
            get_byte("data", 4)
            + get_byte("data", 5) * 256
            + get_byte("data", 6) * 65536
            + get_byte("data", 7) * 16777216
            + 8
        ) = octet_length("data")
    )
);

ALTER TABLE "user_avatars"
ADD CONSTRAINT "user_avatars_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
