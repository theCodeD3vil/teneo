cmake_minimum_required(VERSION 3.22)
project(teneo_local_ai LANGUAGES C CXX OBJC OBJCXX)
include(FetchContent)

if(CMAKE_OSX_ARCHITECTURES STREQUAL "x86_64")
  set(TENEO_TARGET_ARCH "x86_64")
else()
  set(TENEO_TARGET_ARCH "arm64")
endif()

# Allow subprojects with older cmake_minimum_required (SentencePiece v0.2.0)
# to configure cleanly under CMake 4+.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)

# Build only static inference libraries so teneo-ai-service is a single
# self-contained Mach-O executable with zero non-Apple dylibs (required by
# macOS Hardened Runtime Library Validation under self-signed certificates).
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
foreach(option LLAMA_BUILD_COMMON LLAMA_BUILD_TESTS LLAMA_BUILD_TOOLS
    LLAMA_BUILD_EXAMPLES LLAMA_BUILD_SERVER LLAMA_BUILD_APP LLAMA_OPENSSL
    LLAMA_SUBPROCESS GGML_RPC GGML_BACKEND_DL GGML_NATIVE GGML_METAL GGML_OPENMP
    GGML_BLAS)
  set(${option} OFF CACHE BOOL "" FORCE)
endforeach()

FetchContent_Declare(llama_cpp
  URL https://codeload.github.com/ggml-org/llama.cpp/tar.gz/b1b770d90d94cad9e9ea5b993bdbc383a522fb28
  URL_HASH SHA256=ae8556670b17c25931cd39eb7c95617650eaf6091bbcff206750583ddde1acb4
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(llama_cpp)

# Static SentencePiece (v0.2.0 bundles internal absl + protobuf-lite with zero submodules).
set(SPM_ENABLE_SHARED OFF CACHE BOOL "" FORCE)
set(SPM_BUILD_TEST OFF CACHE BOOL "" FORCE)
set(SPM_ENABLE_TCMALLOC OFF CACHE BOOL "" FORCE)
set(SPM_ENABLE_NFKC_COMPILE OFF CACHE BOOL "" FORCE)
set(SPM_CROSS_SYSTEM_PROCESSOR "${TENEO_TARGET_ARCH}" CACHE STRING "" FORCE)

FetchContent_Declare(sentencepiece
  URL https://codeload.github.com/google/sentencepiece/tar.gz/refs/tags/v0.2.0
  URL_HASH SHA256=9970f0a0afee1648890293321665e5b2efa04eaec9f1671fcf8048f456f5bb86
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(sentencepiece)

add_executable(teneo-ai-service service.mm)
target_compile_features(teneo-ai-service PRIVATE cxx_std_17)
target_compile_options(teneo-ai-service PRIVATE -fobjc-arc -Wall -Wextra -DACCELERATE_NEW_LAPACK)
target_include_directories(teneo-ai-service PRIVATE "${sentencepiece_SOURCE_DIR}/src")
target_link_libraries(teneo-ai-service PRIVATE
  llama
  sentencepiece-static
  "-framework Accelerate"
  "-framework Foundation")

add_executable(teneo-ai-client client.m)
target_compile_options(teneo-ai-client PRIVATE -fobjc-arc -Wall -Wextra)
target_link_libraries(teneo-ai-client PRIVATE "-framework Foundation")
